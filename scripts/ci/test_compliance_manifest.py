"""Behaviour of `compliance_manifest.py`: one compliant answer passes, and each
construct the gate exists to refuse turns it red on its own.

Every case starts from the same compliant manifest and document and changes
exactly one thing, so a refusal is attributable to that one change and a
passing baseline proves the refusal is not the gate's default answer.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import http.server
import io
import json
import os
import subprocess
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import compliance_manifest as gate

SITE = "https://site.example/"
REPORTS = "https://reports.example"
MARKER = "/edge-injected/"


DECLARED = {
    "content-security-policy": "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
}


def floor() -> dict:
    """A release manifest from before headers were declared: v1, as at 0.1.103."""
    value = manifest()
    value["schema"] = "compliance/v1"
    del value["headers"]
    return value


def manifest() -> dict:
    return {
        "schema": "compliance/v2",
        "headers": dict(DECLARED),
        "liveUrl": SITE,
        "dataCollected": [
            {"what": "request paths", "where": "pod log", "purpose": "operating the site", "evidence": "evidence.go"}
        ],
        "storage": [
            {"name": "theme", "kind": "cookie", "writtenWhen": "visitor-action", "purpose": "reading mode"},
            {"name": "width", "kind": "localStorage", "writtenWhen": "visitor-action", "purpose": "column width"},
        ],
        "thirdParties": [],
        "legalPages": [{"id": "privacy", "status": "pending", "decision": "https://github.com/owner/site/issues/1"}],
        "edgeObservations": [
            {"kind": "injected-inline-script", "marker": MARKER, "reason": "edge", "issue": "https://github.com/owner/infra/issues/2"},
            {"kind": "reporting-endpoint", "origin": REPORTS, "reason": "edge", "issue": "https://github.com/owner/infra/issues/2"},
        ],
    }


INJECTED_BODY = f"(function(){{var s='{MARKER}main.js'}})();"
INJECTED = f"<script>{INJECTED_BODY}</script>"
HTML = (
    "<!doctype html><html lang=en><head>"
    '<script type="module" src="/assets/index.js"></script>'
    '<link rel="stylesheet" href="/assets/index.css">'
    '<link rel="icon" href="/favicon.svg">'
    "</head><body><main><a href=\"https://elsewhere.example/\">a link is not a load</a></main>"
    f"{INJECTED}"
    "</body></html>"
)


def headers(**overrides: str | None) -> list[tuple[str, str]]:
    base = {
        "Content-Security-Policy": DECLARED["content-security-policy"],
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Permissions-Policy": DECLARED["permissions-policy"],
        "Report-To": json.dumps({"group": "edge", "max_age": 60, "endpoints": [{"url": REPORTS + "/report?s=x"}]}),
        "NEL": '{"report_to":"edge","max_age":60}',
        "Content-Type": "text/html; charset=utf-8",
    }
    for key, value in overrides.items():
        base[key.replace("_", "-")] = value
    return [(key, value) for key, value in base.items() if value is not None]


def document(html: str = HTML, status: int = 200, **overrides: str | None) -> gate.Fetched:
    return gate.Fetched(SITE, status, headers(**overrides), html.encode())


class JudgeTests(unittest.TestCase):
    """The floor every release is held to, judged through a manifest that
    declares no headers (as every v1 release's did), so each rule is seen on
    its own; the declared headers have their own cases."""

    def assertRefused(self, verdict: gate.Verdict, fragment: str) -> None:
        self.assertTrue(
            any(fragment in refusal for refusal in verdict.refusals),
            f"expected a refusal containing {fragment!r}, got {verdict.refusals}",
        )

    def test_the_compliant_baseline_passes(self) -> None:
        verdict = gate.judge(floor(), document(), {})
        self.assertEqual(verdict.refusals, [])
        self.assertIn(f"declared injected script seen: {MARKER}", verdict.notes)

    def test_a_non_200_document_is_refused(self) -> None:
        self.assertRefused(gate.judge(floor(), document(status=403), {}), "answered 403")

    def test_a_missing_csp_is_refused(self) -> None:
        self.assertRefused(gate.judge(floor(), document(Content_Security_Policy=None), {}), "no Content-Security-Policy")

    def test_a_csp_without_default_src_is_refused(self) -> None:
        verdict = gate.judge(floor(), document(Content_Security_Policy="script-src 'self'; frame-ancestors 'none'"), {})
        self.assertRefused(verdict, "no default-src")

    def test_an_undeclared_origin_in_any_fetch_directive_is_refused_with_its_lift(self) -> None:
        for directive in ("script-src", "font-src", "connect-src", "img-src", "style-src", "frame-src"):
            with self.subTest(directive=directive):
                csp = f"default-src 'self'; {directive} 'self' https://cdn.example; frame-ancestors 'none'"
                verdict = gate.judge(floor(), document(Content_Security_Policy=csp), {})
                self.assertRefused(verdict, f"{directive} admits the undeclared origin https://cdn.example")
                self.assertRefused(verdict, '"origin": "https://cdn.example"')

    def test_a_declared_origin_passes_and_an_unused_declaration_is_stale(self) -> None:
        declared = floor()
        declared["thirdParties"] = [
            {"origin": "https://cdn.example", "purpose": "fonts", "consent": "not-required", "reason": "self-hosting is planned"}
        ]
        csp = "default-src 'self'; font-src https://cdn.example; frame-ancestors 'none'"
        self.assertEqual(gate.judge(declared, document(Content_Security_Policy=csp), {}).refusals, [])
        self.assertRefused(gate.judge(declared, document(), {}), "https://cdn.example, which the live CSP no longer admits")

    def test_wildcards_and_bare_schemes_are_refused(self) -> None:
        for source, directive, fragment in (
            ("*", "img-src", "names no single origin"),
            ("https:", "connect-src", "names no single origin"),
            ("*.example", "script-src", "names no single origin"),
            ("data:", "script-src", "admits the bare scheme data:"),
        ):
            with self.subTest(source=source):
                csp = f"default-src 'self'; {directive} {source}; frame-ancestors 'none'"
                self.assertRefused(gate.judge(floor(), document(Content_Security_Policy=csp), {}), fragment)

    def test_data_images_are_ordinary(self) -> None:
        csp = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
        self.assertEqual(gate.judge(floor(), document(Content_Security_Policy=csp), {}).refusals, [])

    def test_inline_or_eval_script_sources_are_refused_but_hashes_pass(self) -> None:
        for source, fragment in (
            ("'unsafe-inline'", "runs code no file of this repository shipped"),
            ("'unsafe-eval'", "runs code no file of this repository shipped"),
            ("'strict-dynamic'", "a keyword this gate does not admit"),
        ):
            with self.subTest(source=source):
                csp = f"default-src 'self'; script-src 'self' {source}; frame-ancestors 'none'"
                self.assertRefused(gate.judge(floor(), document(Content_Security_Policy=csp), {}), fragment)
        # Inline style is not script: the gate leaves it to the CSP tests that own it.
        csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
        self.assertEqual(gate.judge(floor(), document(Content_Security_Policy=csp), {}).refusals, [])
        # A hash names bytes, not a place, so it admits no origin. With no
        # exempted script on the page there is nothing it could let run.
        quiet = floor()
        quiet["edgeObservations"] = quiet["edgeObservations"][1:]
        html = HTML.replace(INJECTED, "")
        csp = "default-src 'self'; script-src 'self' 'sha256-abc='; frame-ancestors 'none'"
        self.assertEqual(gate.judge(quiet, document(html=html, Content_Security_Policy=csp), {}).refusals, [])

    def test_a_declared_injected_script_passes_only_while_every_inline_script_is_blocked(self) -> None:
        # The exemption's stated reason is that the CSP blocks the script. A
        # policy that can admit inline code -- a nonce, a hash, or
        # 'unsafe-inline' in the directive that governs <script> elements --
        # no longer proves that, whether or not it names this script's bytes.
        digest = base64.b64encode(hashlib.sha256(INJECTED_BODY.encode()).digest()).decode()
        probe = f'<script nonce="bm9uY2U=">/* {MARKER} */ window.reviewProbe=1;</script>'
        for csp, html in (
            ("default-src 'self'; script-src 'self' 'nonce-bm9uY2U='; frame-ancestors 'none'", HTML.replace("</body>", probe + "</body>")),
            ("default-src 'self'; script-src 'self' 'nonce-bm9uY2U='; frame-ancestors 'none'", HTML),
            (f"default-src 'self'; script-src 'self' 'sha256-{digest}'; frame-ancestors 'none'", HTML),
            (f"default-src 'self'; script-src-elem 'self' 'sha384-abc='; frame-ancestors 'none'", HTML),
            ("default-src 'self' 'nonce-bm9uY2U='; frame-ancestors 'none'", HTML),
            ("default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'", HTML),
            # An engine without script-src-elem reads script-src.
            ("default-src 'self'; script-src-elem 'self'; script-src 'self' 'nonce-bm9uY2U='; frame-ancestors 'none'", HTML),
            # No directive governs scripts at all, so nothing blocks them.
            ("frame-ancestors 'none'; object-src 'none'", HTML),
        ):
            with self.subTest(csp=csp, probe=probe in html):
                verdict = gate.judge(floor(), document(html=html, Content_Security_Policy=csp), {})
                self.assertRefused(verdict, f"declared injected script marked {MARKER!r}, which this CSP can let run")
        # Every enforced policy must admit a script for it to run, so one
        # policy that blocks all inline code is enough to keep it inert.
        nonce = "default-src 'self'; script-src 'self' 'nonce-bm9uY2U='; frame-ancestors 'none'"
        both = [("Content-Security-Policy", nonce), *headers()]
        self.assertEqual(gate.judge(floor(), gate.Fetched(SITE, 200, both, HTML.encode()), {}).refusals, [])
        # script-src-elem governs <script> elements, so a nonce confined to
        # attribute handlers leaves the element blocked.
        attr = "default-src 'self'; script-src-attr 'nonce-bm9uY2U='; frame-ancestors 'none'"
        self.assertEqual(gate.judge(floor(), document(Content_Security_Policy=attr), {}).refusals, [])

    def test_framing_must_be_denied_somewhere(self) -> None:
        csp = "default-src 'self'"
        self.assertRefused(gate.judge(floor(), document(Content_Security_Policy=csp, X_Frame_Options=None), {}), "framing")
        self.assertEqual(gate.judge(floor(), document(Content_Security_Policy=csp), {}).refusals, [])
        wide = "default-src 'self'; frame-ancestors https://other.example"
        self.assertRefused(gate.judge(floor(), document(Content_Security_Policy=wide), {}), "frame-ancestors admits")

    def test_hsts_must_last_a_year(self) -> None:
        self.assertRefused(gate.judge(floor(), document(Strict_Transport_Security="max-age=86400"), {}), "Strict-Transport-Security")
        self.assertRefused(gate.judge(floor(), document(Strict_Transport_Security=None), {}), "Strict-Transport-Security")

    def test_nosniff_and_referrer_policy_are_required(self) -> None:
        self.assertRefused(gate.judge(floor(), document(X_Content_Type_Options=None), {}), "nosniff")
        self.assertRefused(gate.judge(floor(), document(Referrer_Policy="unsafe-url"), {}), "Referrer-Policy")
        self.assertRefused(gate.judge(floor(), document(Referrer_Policy=None), {}), "Referrer-Policy")

    def test_every_declared_header_is_served_once_with_exactly_its_value(self) -> None:
        for name, value in DECLARED.items():
            title = "-".join(part.capitalize() for part in name.split("-"))
            with self.subTest(header=name):
                self.assertRefused(gate.judge(manifest(), document(**{title.replace("-", "_"): None}), {}), f"declares {name}: ")
                changed = value.replace("()", "(self)", 1) if "()" in value else value + "x"
                self.assertRefused(gate.judge(manifest(), document(**{title.replace("-", "_"): changed}), {}), f"declares {name}: ")
                twice = document()
                twice.headers.append((title, value))
                self.assertRefused(gate.judge(manifest(), twice, {}), f"declares {name}: ")
        # A header the release never declared is not inventory: it passes.
        extra = document()
        extra.headers.append(("X-Unrelated", "1"))
        self.assertEqual(gate.judge(manifest(), extra, {}).refusals, [])

    def test_a_release_that_declared_no_headers_is_held_to_the_floor_alone(self) -> None:
        # What `live` does to 0.1.103: its v1 manifest promised no opener
        # policy and no Permissions-Policy, so today's judge asks for neither.
        released = manifest()
        released["schema"] = "compliance/v1"
        del released["headers"]
        bare = document(Cross_Origin_Opener_Policy=None, Permissions_Policy=None, Content_Security_Policy="default-src 'self'")
        self.assertEqual(gate.judge(released, bare, {}).refusals, [])
        self.assertEqual(gate.shape(released), [])

    def test_a_cookie_on_the_document_is_refused(self) -> None:
        self.assertRefused(gate.judge(floor(), document(Set_Cookie="tracker=1; Path=/"), {}), "'tracker'")

    def test_an_undeclared_reporting_endpoint_is_refused_and_a_vanished_one_is_stale(self) -> None:
        other = json.dumps({"group": "x", "endpoints": [{"url": "https://collector.example/r"}]})
        self.assertRefused(gate.judge(floor(), document(Report_To=other), {}), "undeclared origin https://collector.example")
        self.assertRefused(gate.judge(floor(), document(Report_To=other), {}), f"reporting endpoint {REPORTS}, which no longer occurs")
        endpoints = 'default="https://collector.example/r"'
        self.assertRefused(gate.judge(floor(), document(Reporting_Endpoints=endpoints), {}), "https://collector.example")
        csp = "default-src 'self'; frame-ancestors 'none'; report-uri https://collector.example/csp"
        self.assertRefused(gate.judge(floor(), document(Content_Security_Policy=csp), {}), "https://collector.example")

    def test_an_undeclared_inline_script_is_refused_and_a_vanished_one_is_stale(self) -> None:
        html = HTML.replace(MARKER, "/something-else/")
        verdict = gate.judge(floor(), document(html=html), {})
        self.assertRefused(verdict, "inline script this repository did not build")
        self.assertRefused(verdict, f"marked {MARKER!r} that no longer occurs")

    def test_a_remote_script_stylesheet_or_embed_in_the_html_is_refused(self) -> None:
        for snippet in (
            '<script src="https://cdn.example/x.js"></script>',
            '<link rel="stylesheet" href="https://fonts.example/css">',
            '<link rel="preconnect" href="https://fonts.example">',
            '<img src="https://pixel.example/p.gif" alt="">',
            '<iframe src="https://widget.example/"></iframe>',
            '<img srcset="/a.png 1x, https://pixel.example/b.png 2x" alt="">',
        ):
            with self.subTest(snippet=snippet):
                html = HTML.replace("</body>", snippet + "</body>")
                self.assertRefused(gate.judge(floor(), document(html=html), {}), "loads")

    def test_a_published_legal_page_must_answer_html(self) -> None:
        published = floor()
        published["legalPages"] = [{"id": "privacy", "status": "published", "path": "/privacy"}]
        ok = gate.Fetched(SITE + "privacy", 200, [("Content-Type", "text/html")], b"<p>notice</p>")
        self.assertEqual(gate.judge(published, document(), {"/privacy": ok}).refusals, [])
        missing = gate.Fetched(SITE + "privacy", 404, [("Content-Type", "text/plain")], b"")
        self.assertRefused(gate.judge(published, document(), {"/privacy": missing}), "answered 404")
        wrong = gate.Fetched(SITE + "privacy", 200, [("Content-Type", "application/json")], b"{}")
        self.assertRefused(gate.judge(published, document(), {"/privacy": wrong}), "not served as text/html")


class ValidateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.repo = Path(self.scratch.name)
        (self.repo / "evidence.go").write_text("package x\n")
        self.source = self.repo / "frontend" / "src"
        self.source.mkdir(parents=True)
        # The repository's own shapes: a cookie assigned by literal name, and
        # a storage key bound to a constant and written through a store seam.
        (self.source / "theme.ts").write_text(
            "document.cookie = 'theme=' + id;\n"
            "export const widthKey = 'width';\n"
            "const store = window.localStorage;\n"
            "store.setItem(widthKey, v);\n"
        )

    def refusals(self, value: object) -> list[str]:
        return gate.validate(value, source_root=self.source, repo_root=self.repo)

    def test_the_baseline_validates(self) -> None:
        self.assertEqual(self.refusals(manifest()), [])

    def test_the_schema_is_closed(self) -> None:
        extra = manifest()
        extra["thirdparties"] = []
        self.assertTrue(any("unknown key 'thirdparties'" in r for r in self.refusals(extra)))
        missing = manifest()
        del missing["legalPages"]
        self.assertTrue(any("'legalPages'" in r for r in self.refusals(missing)))
        nested = manifest()
        nested["storage"][0]["expires"] = "1y"
        self.assertTrue(any("unknown key 'expires'" in r for r in self.refusals(nested)))
        self.assertEqual(self.refusals([]), ["compliance.json must be one JSON object"])

    def test_every_field_needs_words(self) -> None:
        blank = manifest()
        blank["storage"][0]["purpose"] = " "
        self.assertTrue(any("storage[0].purpose" in r for r in self.refusals(blank)))

    def test_storage_must_be_written_by_the_visitor_and_still_written_somewhere(self) -> None:
        on_load = manifest()
        on_load["storage"][0]["writtenWhen"] = "on-load"
        self.assertTrue(any("needs consent" in r for r in self.refusals(on_load)))
        stale = manifest()
        stale["storage"][1]["name"] = "renamed"
        self.assertTrue(any("'renamed', which no file" in r for r in self.refusals(stale)))
        (self.source / "theme.ts").write_text("document.cookie = 'theme=' + id;\n")
        self.assertTrue(any("'width', which no file" in r for r in self.refusals(manifest())))

    def test_every_present_section_is_a_list_and_null_is_not_absent(self) -> None:
        for section in gate.ENTRY_KEYS:
            for value in (None, {}, "none"):
                with self.subTest(section=section, value=value):
                    changed = manifest()
                    changed[section] = value
                    self.assertIn(f"{section} must be a list", self.refusals(changed))

    def test_the_schema_version_is_pinned(self) -> None:
        changed = manifest()
        changed["schema"] = "compliance/v3"
        self.assertIn("compliance.json schema must be one of ['compliance/v1', 'compliance/v2']", self.refusals(changed))
        # v1 is still READ, at the tags of the releases that shipped it, but
        # the head must declare its headers.
        released = manifest()
        released["schema"] = "compliance/v1"
        del released["headers"]
        self.assertEqual(gate.shape(released), [])
        self.assertTrue(any("must be 'compliance/v2'" in r for r in self.refusals(released)))
        released["headers"] = dict(DECLARED)
        self.assertIn(
            "compliance.json carries the unknown key 'headers'; the schema is closed so a typo cannot pass silently",
            gate.shape(released),
        )

    def test_the_declared_headers_keep_the_floor(self) -> None:
        def declared(**changes: str | None) -> list[str]:
            value = manifest()
            for name, header in changes.items():
                name = name.replace("_", "-")
                if header is None:
                    del value["headers"][name]
                else:
                    value["headers"][name] = header
            return self.refusals(value)

        self.assertTrue(any("cross-origin-opener-policy: same-origin" in r for r in declared(cross_origin_opener_policy=None)))
        self.assertTrue(any("cross-origin-opener-policy: same-origin" in r for r in declared(cross_origin_opener_policy="unsafe-none")))
        self.assertTrue(any("content-security-policy with a default-src" in r for r in declared(content_security_policy=None)))
        self.assertTrue(any("content-security-policy with a default-src" in r for r in declared(content_security_policy="script-src 'self'")))
        self.assertTrue(any("denies camera=()" in r for r in declared(permissions_policy=None)))
        # Written out rather than derived from the judge, so a feature dropped
        # from DENIED_FEATURES fails here: the origin's own five, less one.
        origin = "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
        for feature in ("camera", "geolocation", "microphone", "payment", "usb"):
            with self.subTest(feature=feature):
                admitted = origin.replace(f"{feature}=()", f"{feature}=(self)")
                self.assertTrue(any(f"denies {feature}=()" in r for r in declared(permissions_policy=admitted)))
                omitted = ", ".join(item for item in origin.split(", ") if not item.startswith(feature))
                self.assertTrue(any(f"denies {feature}=()" in r for r in declared(permissions_policy=omitted)))
        # Denying more, in any order, keeps the floor.
        self.assertEqual(declared(permissions_policy="fullscreen=(), " + ", ".join(reversed(origin.split(", ")))), [])
        self.assertTrue(any("lowercase HTTP field name" in r for r in declared(**{"X_Frame_Options": "DENY"})))
        self.assertTrue(any("headers.x-frame-options must be a non-empty string" in r for r in declared(x_frame_options=" ")))
        for empty in ({}, [], "default-src 'none'", None):
            with self.subTest(headers=empty):
                value = manifest()
                value["headers"] = empty
                self.assertIn(
                    "headers must be an object naming each security header the release sends and its exact value",
                    self.refusals(value),
                )

    def test_every_entry_is_an_object(self) -> None:
        changed = manifest()
        changed["storage"] = ["theme", *changed["storage"]]
        self.assertIn("storage[0] must be an object", self.refusals(changed))

    def test_every_required_field_is_present(self) -> None:
        valid = {
            "dataCollected": manifest()["dataCollected"][0],
            "storage": manifest()["storage"][0],
            "thirdParties": {"origin": "https://cdn.example", "purpose": "p", "consent": "not-required", "reason": "r"},
            "legalPages": manifest()["legalPages"][0],
            "edgeObservations": manifest()["edgeObservations"][0],
        }
        for section, (required, _) in gate.ENTRY_KEYS.items():
            for key in sorted(required):
                with self.subTest(section=section, key=key):
                    entry = dict(valid[section])
                    del entry[key]
                    changed = manifest()
                    changed[section] = [entry]
                    self.assertIn(f"{section}[0] lacks {key!r}", self.refusals(changed))

    def test_the_storage_kind_is_closed(self) -> None:
        changed = manifest()
        changed["storage"][1]["kind"] = "indexedDB"
        self.assertIn("storage[1].kind must be one of ['cookie', 'localStorage', 'sessionStorage']", self.refusals(changed))

    def test_only_a_write_of_the_declared_kind_keeps_a_storage_entry_alive(self) -> None:
        for source in (
            # A bare literal and a read: the reproduction from the review.
            'const a = "theme"; localStorage.getItem("width");',
            # Reads of both stores.
            "if (document.cookie === 'theme=dark') {}\nconst w = window.localStorage.getItem('width');\n",
            # Writes that survive only as comments.
            "// document.cookie = 'theme=' + id;\n/* window.localStorage.setItem('width', v) */\n",
            # A line comment that ends the file, with no line terminator after it.
            "// document.cookie = 'theme=1'; localStorage.setItem('width', value)",
            "<!-- document.cookie = 'theme=1'; window.localStorage.setItem('width', v) -->\n",
            # Each name written, but to the other kind of storage.
            "window.localStorage.setItem('theme', v);\ndocument.cookie = 'width=' + v;\n",
            "window.sessionStorage.setItem('width', v);\n",
            # The write's own receiver decides, not another store the file names.
            "window.sessionStorage.setItem('width', v);\nwindow.localStorage.getItem('width');\n",
            # Writes that exist only as the text of a string, a template or a
            # regular expression never execute (the first is the review's own).
            "const a = \"document.cookie = 'theme=dark'\"; const store = localStorage; "
            "const b = \"store.setItem('width', '1')\";",
            "const t = `document.cookie = 'theme=1'; localStorage.setItem('width', v)`;\n",
            "const r = /document.cookie = 'theme=1'; localStorage.setItem\\('width', v\\)/;\n",
            # A read with a second argument, which getItem ignores, is a read.
            "localStorage.getItem('width', undefined);\n",
        ):
            with self.subTest(source=source):
                (self.source / "theme.ts").write_text(source)
                refusals = self.refusals(manifest())
                self.assertTrue(any("cookie 'theme', which no file under frontend/src writes" in r for r in refusals), refusals)
                self.assertTrue(any("localStorage 'width', which no file under frontend/src writes" in r for r in refusals), refusals)

    def test_a_write_only_a_test_file_makes_keeps_nothing_alive(self) -> None:
        (self.source / "theme.test.ts").write_text((self.source / "theme.ts").read_text())
        (self.source / "theme.ts").write_text("export {};\n")
        refusals = self.refusals(manifest())
        self.assertTrue(any("'theme', which no file" in r for r in refusals), refusals)
        self.assertTrue(any("'width', which no file" in r for r in refusals), refusals)

    def test_a_write_by_literal_or_through_a_bound_name_counts(self) -> None:
        for source in (
            "document.cookie = `theme=${id}`;\nwindow.localStorage.setItem('width', v);\n",
            'document.cookie = "theme=" + id; // not \'width\'\nconst key: string = "width";\n'
            "const s = localStorage;\ns.setItem(key, v);\n",
            # Code inside a template's ${...} is code.
            "document.cookie = `theme=${id}`;\nconst t = `${window.localStorage.setItem('width', v)}`;\n",
            # A quote or backtick inside a regular expression opens nothing,
            # and a division is no regular expression.
            "const quote = /'/g; document.cookie = 'theme=' + id; window.localStorage.setItem('width', v);\n",
            "const tick = /`/;\ndocument.cookie = 'theme=' + id;\nwindow.localStorage.setItem('width', v);\n",
            "const half = a / 2; document.cookie = 'theme=1'; window.localStorage.setItem('width', v); const c = b / 3;\n",
        ):
            with self.subTest(source=source):
                (self.source / "theme.ts").write_text(source)
                self.assertEqual(self.refusals(manifest()), [])

    def test_in_a_component_only_script_and_expressions_are_code(self) -> None:
        (self.source / "theme.ts").write_text("export {};\n")
        component = self.source / "Panel.svelte"
        # An apostrophe in a sentence opens no string, and a block's closing
        # `{/if}` opens no regular expression, so the handlers after them count.
        component.write_text(
            "<script lang=\"ts\">\n  const key = 'width';\n</script>\n"
            "<p>Don't</p> <button onclick={() => window.localStorage.setItem(key, v)}>Save</button>\n"
            "{#if open}{label}{/if}<a href=\"/x\">Don't</a> <button onclick={() => (document.cookie = 'theme=1')}>Dark</button>\n"
            "<style>p { color: red; }</style>\n"
        )
        self.assertEqual(self.refusals(manifest()), [])
        # Markup text, an HTML comment and a stylesheet are not code.
        component.write_text(
            "<p>document.cookie = 'theme=1'; window.localStorage.setItem('width', v)</p>\n"
            "<!-- {window.localStorage.setItem('width', v)} -->\n"
            "<style>.x { --a: document.cookie = 'theme=1'; }</style>\n"
        )
        refusals = self.refusals(manifest())
        self.assertTrue(any("cookie 'theme', which no file" in r for r in refusals), refusals)
        self.assertTrue(any("localStorage 'width', which no file" in r for r in refusals), refusals)

    # A script file, a component's script, and a component's markup expression.
    PLACES = (
        ("probe.js", "", "\n"),
        ("Probe.svelte", "<script>\n", "\n</script>\n"),
        ("Handler.svelte", "<button onclick={() => {\n", "\n}}>x</button>\n"),
    )

    def ambiguous(self, name: str, refusals: list[str]) -> bool:
        return any(f"frontend/src/{name}: the storage scan cannot tell whether the `/`" in r for r in refusals)

    def test_a_slash_that_can_divide_or_open_a_regex_refuses_when_the_reading_matters(self) -> None:
        # After `)`, `}`, `++`, `--` or `of` a `/` can divide or open a regular
        # expression; only a parser knows which. Each file is read both ways,
        # and a file whose writes depend on the reading is refused.
        for line in (
            # The review's: a division read as a regex hides a write, and a
            # regex read as a division opens a string that hides one.
            "const a = {} / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "if (true) /'/.test('x'); localStorage.setItem('undeclared','1');",
            # The same after a block, and after a postfix increment or decrement.
            "{}\n/'/.test('x'); localStorage.setItem('undeclared', '1');",
            "let i = 0; const a = i++ / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "let i = 0; const a = i-- / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            # The readings differ only in a key neither can read.
            "const a = {} / 2; localStorage.setItem(key, '1'); const b = 3 / 4;",
            # Read all one way or all the other, neither finds the write; the
            # mixed reading, which is the real one, does. Each reading meets
            # two such slashes in one of these, and only one in the other.
            "if (x) /`/.test(s);\nconst a = {} / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "for (const k of (a) / (b)) /'/.test(k); localStorage.setItem('undeclared', '1');",
            # `of` is a name as often as it is a keyword, and `)!` can end a
            # call TypeScript asserts non-null or begin a negated regex.
            "const of = 4; const a = of / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "const a = f()! / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
        ):
            for name, before, after in self.PLACES:
                with self.subTest(place=name, line=line):
                    (self.source / name).write_text(before + line + after)
                    refusals = self.refusals(manifest())
                    self.assertTrue(self.ambiguous(name, refusals), refusals)
                    (self.source / name).unlink()
        # The review's third: no write executes, so nothing it holds keeps a
        # declaration alive.
        (self.source / "theme.ts").write_text("export {};\n")
        for name, before, after in self.PLACES:
            with self.subTest(place=name):
                (self.source / name).write_text(
                    before + "if (true) /document.cookie = 'theme=1'; localStorage.setItem('width', value)/.test('x');" + after
                )
                refusals = self.refusals(manifest())
                self.assertTrue(self.ambiguous(name, refusals), refusals)
                self.assertTrue(any("cookie 'theme', which no file" in r for r in refusals), refusals)
                self.assertTrue(any("localStorage 'width', which no file" in r for r in refusals), refusals)
                (self.source / name).unlink()

    def test_a_negation_after_a_line_break_is_no_non_null_assertion(self) -> None:
        # On one line `x!` is TypeScript's non-null assertion and a `/` after
        # it divides. With a line terminator between them, a comment's
        # included, `x` ends its statement and the `!` negates, so the `/`
        # opens a regex: the scan calls that `!` ambiguous.
        for gap in ("\n", " /* a\n b */ ", " /* a\u2028b */ ", "\u2028", "\u2029"):
            for name, before, after in self.PLACES:
                with self.subTest(place=name, gap=gap):
                    (self.source / name).write_text(
                        before + "let x = 1;\nx" + gap + "!/'/.test('x'); localStorage.setItem('undeclared', '1');" + after
                    )
                    refusals = self.refusals(manifest())
                    self.assertTrue(self.ambiguous(name, refusals), refusals)
                    (self.source / name).unlink()
        # The inverse: the write-shaped text is the regex, so it keeps no
        # declaration alive.
        (self.source / "theme.ts").write_text("export {};\n")
        for name, before, after in self.PLACES:
            with self.subTest(place=name, inverse=True):
                (self.source / name).write_text(
                    before + "let x = 1;\nx\n!/document.cookie = 'theme=1'; localStorage.setItem('width', value)/.test('x');"
                    + after
                )
                refusals = self.refusals(manifest())
                self.assertTrue(self.ambiguous(name, refusals), refusals)
                self.assertTrue(any("cookie 'theme', which no file" in r for r in refusals), refusals)
                self.assertTrue(any("localStorage 'width', which no file" in r for r in refusals), refusals)
                (self.source / name).unlink()

    def test_a_division_after_a_property_or_a_non_null_assertion_hides_no_write(self) -> None:
        # A property may be called anything, and TypeScript's `x!` ends an
        # operand where `!x` begins one: each `/` here can only divide.
        for line in (
            "const a = map.delete / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "const a = map. delete / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "const a = el.offsetWidth! / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "const a = x!/2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            # `this` is an operand, a name continues across a line break, and
            # a name on the line after `break` is no label.
            "const a = this / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "let x = 4;\nconst y = x\n/ 2 / 1; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "while (go()) { if (stop) break\nx / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4; }",
            "while (go()) { if (stop) break /* \u2028 */ x / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4; }",
        ):
            for name, before, after in self.PLACES:
                with self.subTest(place=name, line=line):
                    (self.source / name).write_text(before + line + after)
                    refusals = self.refusals(manifest())
                    self.assertTrue(any(f"{name} writes localStorage 'undeclared'" in r for r in refusals), refusals)
                    self.assertFalse(self.ambiguous(name, refusals), refusals)
                    (self.source / name).unlink()

    def test_a_regex_after_a_statement_ending_keyword_hides_no_write(self) -> None:
        # `debugger` is a whole statement, `break` and `continue` take at
        # most a label on the same line, and `export default` and `extends`
        # want an expression: a `/` after any of them opens a regex.
        statements = (
            "debugger\n/'/.test('x'); localStorage.setItem('undeclared', '1');",
            "while (go()) { if (stop) break\n/'/.test('x'); localStorage.setItem('undeclared', '1'); }",
            "while (go()) { if (skip) continue\n/'/.test('x'); localStorage.setItem('undeclared', '1'); }",
            "outer: while (go()) { if (stop) break outer\n/'/.test('x'); localStorage.setItem('undeclared', '1'); }",
            "outer: while (go()) { if (skip) continue outer\n/'/.test('x'); localStorage.setItem('undeclared', '1'); }",
            "class A extends /'/ {} localStorage.setItem('undeclared', '1');",
        )
        module = (("probe.js", "", "\n"),)  # `export default` belongs to a module's top level
        for places, line in [(self.PLACES, line) for line in statements] + [
            (module, "export default /'/; localStorage.setItem('undeclared', '1');")
        ]:
            for name, before, after in places:
                with self.subTest(place=name, line=line):
                    (self.source / name).write_text(before + line + after)
                    refusals = self.refusals(manifest())
                    self.assertTrue(any(f"{name} writes localStorage 'undeclared'" in r for r in refusals), refusals)
                    self.assertFalse(self.ambiguous(name, refusals), refusals)
                    (self.source / name).unlink()
        # The inverse: the write-shaped text is the regex, so it keeps no
        # declaration alive.
        (self.source / "theme.ts").write_text("export {};\n")
        for name, before, after in self.PLACES:
            with self.subTest(place=name, inverse=True):
                (self.source / name).write_text(
                    before + "debugger\n/document.cookie = 'theme=1'; localStorage.setItem('width', value)/.test('x');"
                    + after
                )
                refusals = self.refusals(manifest())
                self.assertTrue(any("cookie 'theme', which no file" in r for r in refusals), refusals)
                self.assertTrue(any("localStorage 'width', which no file" in r for r in refusals), refusals)
                self.assertFalse(self.ambiguous(name, refusals), refusals)
                (self.source / name).unlink()

    def test_a_name_spelled_with_a_unicode_escape_is_refused(self) -> None:
        # An escape can spell a label the slash rule must see, or the very
        # names the write patterns look for; the scan refuses it instead.
        for line in (
            "outer: for (;;) {\n  if (stop) break \\u006futer\n  /'/.test('x'); localStorage.setItem('undeclared', '1');\n}",
            "outer: for (;;) {\n  if (stop) break \\u{6f}uter\n  /'/.test('x'); localStorage.setItem('undeclared', '1');\n}",
            "outer: for (;;) {\n  if (skip) continue \\u006futer\n  /'/.test('x'); localStorage.setItem('undeclared', '1');\n}",
            "outer: for (;;) {\n  if (skip) continue \\u{6f}uter\n  /'/.test('x'); localStorage.setItem('undeclared', '1');\n}",
            "document.\\u0063ookie = 'theme=1';\nlocal\\u0053torage.setItem('undeclared', '1');",
            "localStorage.set\\u{49}tem('undeclared', '1');",
        ):
            for name, before, after in self.PLACES:
                with self.subTest(place=name, line=line):
                    (self.source / name).write_text(before + line + after)
                    refusals = self.refusals(manifest())
                    first = (before + line).index("\\")
                    at = (before + line)[:first].count("\n") + 1
                    expected = f"frontend/src/{name} spells a name with a Unicode escape on line {at}; write the name plainly"
                    self.assertIn(expected, refusals)
                    (self.source / name).unlink()

    def test_a_name_may_hold_any_non_ascii_character_but_white_space(self) -> None:
        # Every JavaScript punctuator is ASCII, so in code a non-ASCII
        # character that is not white space belongs to a name: a combining
        # mark, a joiner or a middle dot inside a label keeps it a label,
        # and a byte order mark between `break` and its label is white space.
        for label, gap in (("a\u0301", " "), ("a\u200db", " "), ("a\u00b7b", " "), ("outer", "\ufeff")):
            for keyword in ("break", "continue"):
                line = (f"{label}: for (;;) {{ if (go) {keyword}{gap}{label}\n"
                        "/'/.test('x'); localStorage.setItem('undeclared', '1'); }")
                for name, before, after in self.PLACES:
                    with self.subTest(place=name, label=label, keyword=keyword):
                        (self.source / name).write_text(before + line + after)
                        refusals = self.refusals(manifest())
                        self.assertTrue(any(f"{name} writes localStorage 'undeclared'" in r for r in refusals), refusals)
                        self.assertFalse(self.ambiguous(name, refusals), refusals)
                        (self.source / name).unlink()
        # A byte order mark before a line break leaves `debugger` a statement
        # end, and one after a line break leaves the `!` after it ambiguous.
        for line, ambiguous in (
            ("debugger\ufeff\n/'/.test('x'); localStorage.setItem('undeclared', '1');", False),
            ("let x = 1;\nx\n\ufeff!/'/.test('x'); localStorage.setItem('undeclared', '1');", True),
        ):
            for name, before, after in self.PLACES:
                with self.subTest(place=name, line=line):
                    (self.source / name).write_text(before + line + after)
                    refusals = self.refusals(manifest())
                    self.assertEqual(self.ambiguous(name, refusals), ambiguous, refusals)
                    if not ambiguous:
                        self.assertTrue(any(f"{name} writes localStorage 'undeclared'" in r for r in refusals), refusals)
                    (self.source / name).unlink()
        # A non-ASCII operand still divides.
        for line in (
            "const \u00e9 = 4; const a = \u00e9 / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
            "const x\u0301 = 4; const a = x\u0301 / 2; localStorage.setItem('undeclared', '1'); const b = 3 / 4;",
        ):
            for name, before, after in self.PLACES:
                with self.subTest(place=name, line=line):
                    (self.source / name).write_text(before + line + after)
                    refusals = self.refusals(manifest())
                    self.assertTrue(any(f"{name} writes localStorage 'undeclared'" in r for r in refusals), refusals)
                    self.assertFalse(self.ambiguous(name, refusals), refusals)
                    (self.source / name).unlink()

    def test_a_slash_whose_reading_changes_nothing_passes(self) -> None:
        # The fixture's theme.ts writes only the cookie here, so each case
        # passes only if its own width write is found.
        (self.source / "theme.ts").write_text("document.cookie = 'theme=' + id;\n")
        for line in (
            # No regular expression can start there, so both readings are one.
            "const o = {} / 2;\nconst m = (a + b) / 2;\nlet i = 0; const n = i++ / 2;\n"
            "window.localStorage.setItem('width', v);",
            # One can, and both readings find the same write after it.
            "const c = (a - b) / 2 - w / 2; window.localStorage.setItem('width', v);",
            # A regular expression made unambiguous, after a negation, after a
            # keyword, or at the very start, then a write.
            "if (true) (/'/).test('x'); window.localStorage.setItem('width', v);",
            "if (!/'/.test(s)) window.localStorage.setItem('width', v);",
            "function f(s) { return /'/.test(s); } window.localStorage.setItem('width', v);",
            "/'/.test(s); window.localStorage.setItem('width', v);",
            # A negation that starts a statement or a line stays one.
            "let x = 1;\n!/'/.test(s); window.localStorage.setItem('width', v);",
            "if (a ||\n!/'/.test(s)) window.localStorage.setItem('width', v);",
            # A backslash inside a string, a template, a regex or a comment
            # spells no name.
            "const s = '\\u0041' + `\\u0041` + /\\u0041/.source; // \\u0041\n/* \\u0041 */ "
            "window.localStorage.setItem('width', v);",
            # A line comment ends at any line terminator, not only "\n".
            "let x = 1; // note\u2028window.localStorage.setItem('width', v);",
            "let x = 1; // note\u2029window.localStorage.setItem('width', v);",
        ):
            for name, before, after in self.PLACES:
                with self.subTest(place=name, line=line):
                    (self.source / name).write_text(before + line + after)
                    self.assertEqual(self.refusals(manifest()), [])
                    (self.source / name).unlink()

    def test_an_undeclared_write_is_refused_with_its_lift(self) -> None:
        with (self.source / "theme.ts").open("a") as source:
            source.write("window.sessionStorage.setItem('draft', v);\ndocument.cookie = 'seen=1';\n")
        refusals = self.refusals(manifest())
        self.assertTrue(any("theme.ts writes sessionStorage 'draft', which compliance.json does not declare" in r for r in refusals), refusals)
        self.assertTrue(any("theme.ts writes cookie 'seen', which compliance.json does not declare" in r for r in refusals), refusals)
        self.assertTrue(any('{"name": "draft", "kind": "sessionStorage"' in r for r in refusals), refusals)

    def test_a_write_whose_key_or_store_cannot_be_read_is_refused(self) -> None:
        base = (self.source / "theme.ts").read_text()
        for call in (
            "function put(key, v) { window.localStorage.setItem(key, v); }\n",
            # A key built at run time is no literal, whatever literal it starts with.
            "window.localStorage.setItem('wid' + 'th', v);\n",
            "window.localStorage.setItem(`${prefix}width`, v);\n",
            "window.localStorage.setItem(keys.width, v);\n",
            # A binding that exists only as text binds nothing.
            "const note = \"const key = 'width'\"; // const key = 'width'\nwindow.localStorage.setItem(key, v);\n",
        ):
            with self.subTest(call=call):
                (self.source / "theme.ts").write_text(base + call)
                refusals = self.refusals(manifest())
                self.assertTrue(any("whose key this gate cannot read" in r for r in refusals), refusals)
        # A store named only in a sentence or a string is not named by code.
        (self.source / "theme.ts").write_text(
            "document.cookie = 'theme=1';\nconst note = 'kept in localStorage'; // or localStorage\n"
            "export function put(s, v) { s.setItem('width', v); }\n"
        )
        self.assertTrue(any("whose storage this gate cannot name" in r for r in self.refusals(manifest())), self.refusals(manifest()))

    def test_collection_evidence_must_exist(self) -> None:
        (self.repo / "evidence.go").unlink()
        self.assertTrue(any("evidence 'evidence.go' no longer exists" in r for r in self.refusals(manifest())))

    def test_third_parties_need_a_bare_origin_and_no_consent_requirement(self) -> None:
        bad = manifest()
        bad["thirdParties"] = [{"origin": "https://cdn.example/path", "purpose": "p", "consent": "required", "reason": "r"}]
        refusals = self.refusals(bad)
        self.assertTrue(any("bare https origin" in r for r in refusals))
        self.assertTrue(any("consent mechanism" in r for r in refusals))

    def test_legal_pages_are_published_with_a_path_or_pending_with_a_decision(self) -> None:
        for page, fragment in (
            ({"id": "privacy", "status": "published"}, "needs the absolute path"),
            ({"id": "privacy", "status": "pending"}, "needs the issue URL"),
            ({"id": "privacy", "status": "pending", "decision": "soon"}, "needs the issue URL"),
            ({"id": "privacy", "status": "drafted", "path": "/p"}, "status must be one of"),
        ):
            with self.subTest(page=page):
                value = manifest()
                value["legalPages"] = [page]
                self.assertTrue(any(fragment in r for r in self.refusals(value)), self.refusals(value))
        twice = manifest()
        twice["legalPages"] = twice["legalPages"] * 2
        self.assertTrue(any("declared twice" in r for r in self.refusals(twice)))

    def test_edge_observations_name_what_they_are_and_where_the_decision_lives(self) -> None:
        for change, fragment in (
            ({"kind": "cookie"}, "kind must be one of"),
            ({"issue": "later"}, "issue URL that holds the decision"),
        ):
            with self.subTest(change=change):
                value = manifest()
                value["edgeObservations"][0].update(change)
                self.assertTrue(any(fragment in r for r in self.refusals(value)))
        no_marker = manifest()
        del no_marker["edgeObservations"][0]["marker"]
        self.assertTrue(any("needs the marker" in r for r in self.refusals(no_marker)))
        no_origin = manifest()
        no_origin["edgeObservations"][1]["origin"] = "reports.example"
        self.assertTrue(any("bare https origin the reports go to" in r for r in self.refusals(no_origin)))

    def test_the_live_url_must_be_https(self) -> None:
        value = manifest()
        value["liveUrl"] = "http://site.example/"
        self.assertTrue(any("liveUrl" in r for r in self.refusals(value)))


class ShippedManifestTests(unittest.TestCase):
    def test_the_repository_manifest_validates(self) -> None:
        manifest_value = json.loads(gate.MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(gate.validate(manifest_value), [])

    def test_check_mode_reports_its_decision(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(gate.main(["check"]), 0)
        self.assertIn("SUMMARY mode=check decision=pass refusals=0", output.getvalue())

    def test_check_mode_fails_on_an_unreadable_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            broken = Path(scratch) / "compliance.json"
            broken.write_text("{")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(gate.main(["check", "--manifest", str(broken)]), 1)
        self.assertIn("decision=fail", output.getvalue())


MAIN_CHANGED = 1_800_000_000  # when the fixture's main set VERSION to 0.1.104
HOUR = 3600


class Releases:
    """A git repository shaped like the one `live` reads: v0.1.103 shipped a
    v1 manifest, v0.1.104 the v2 one with declared headers, v0.1.105 none at
    all, and origin/main set VERSION to 0.1.104 at MAIN_CHANGED."""

    def __init__(self, root: Path, main: bool = True) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.env = {
            **os.environ,
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
            "GIT_COMMITTER_NAME": "Fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        }
        self.git("init", "-q", "-b", "trunk")
        self.release("0.1.103", floor(), MAIN_CHANGED - 30 * HOUR)
        main_commit = self.release("0.1.104", manifest(), MAIN_CHANGED)
        self.release("0.1.105", None, MAIN_CHANGED + HOUR)
        if main:
            self.git("update-ref", "refs/remotes/origin/main", main_commit)

    def git(self, *args: str, when: int | None = None) -> str:
        env = dict(self.env)
        if when is not None:
            env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"@{when} +0000"
        return subprocess.run(
            ["git", "-C", str(self.root), *args], check=True, text=True, capture_output=True, env=env
        ).stdout.strip()

    def release(self, version: str, value: dict | None, when: int) -> str:
        (self.root / "VERSION").write_text(version + "\n")
        path = self.root / "compliance.json"
        if value is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(json.dumps(value))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", version, when=when)
        self.git("tag", "-a", f"v{version}", "-m", version, when=when)
        return self.git("rev-parse", "HEAD")


def named(version: str | None, **overrides: str | None) -> gate.Fetched:
    """The compliant document, naming `version` in X-Site-Version."""
    answer = document(**overrides)
    if version is not None:
        answer.headers.append(("X-Site-Version", version))
    return answer


def no_build(repository: Path, tag: str) -> set[str]:
    raise AssertionError(f"a site that names its release must never cost a build (asked for {tag})")


class DeployedTests(unittest.TestCase):
    """`live`: production judged against the manifest of the release it runs."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.scratch = tempfile.TemporaryDirectory()
        root = Path(cls.scratch.name)
        cls.repository = Releases(root / "releases").root
        cls.no_main = Releases(root / "releases-no-main", main=False).root
        # The HEAD manifest a fallback would reach for: one the compliant
        # site satisfies, so a judge that fell back to it would pass.
        cls.head = root / "compliance.json"
        cls.head.write_text(json.dumps(manifest()))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.scratch.cleanup()

    def live(self, answer: gate.Fetched, build=no_build, now: int = MAIN_CHANGED + HOUR, repository=None) -> tuple[int, str]:
        output = io.StringIO()
        with redirect_stdout(output):
            code = gate.run_live(
                self.head, fetcher=lambda url: answer, repository=repository or self.repository, build=build, now=lambda: now
            )
        return code, output.getvalue()

    def test_a_named_release_is_judged_against_its_own_tagged_manifest(self) -> None:
        code, output = self.live(named("0.1.104"))
        self.assertEqual(code, 0, output)
        self.assertIn("deployed release 0.1.104, named by X-Site-Version; judged against v0.1.104:compliance.json", output)

    def test_a_release_is_held_to_what_it_declared(self) -> None:
        # 0.1.103 promised no opener policy, so its site passes without one...
        bare = {"Cross_Origin_Opener_Policy": None, "Permissions_Policy": None}
        code, output = self.live(named("0.1.103", **bare))
        self.assertEqual(code, 0, output)
        # ...and a site naming 0.1.104 is held to 0.1.104's promises.
        for header, overrides in (
            ("cross-origin-opener-policy", {"Cross_Origin_Opener_Policy": None}),
            ("permissions-policy", {"Permissions_Policy": "camera=(), geolocation=(), microphone=()"}),
        ):
            with self.subTest(header=header):
                code, output = self.live(named("0.1.104", **overrides))
                self.assertEqual(code, 1, output)
                self.assertIn(f"REFUSE the manifest declares {header}: ", output)

    def test_a_release_with_no_tag_fails(self) -> None:
        code, output = self.live(named("0.1.199"))
        self.assertEqual(code, 1, output)
        self.assertIn("no tag v0.1.199 exists", output)

    def test_a_tag_with_no_manifest_fails(self) -> None:
        code, output = self.live(named("0.1.105"))
        self.assertEqual(code, 1, output)
        self.assertIn("tag v0.1.105 carries no compliance.json", output)

    def test_a_release_named_badly_fails(self) -> None:
        twice = named("0.1.104")
        twice.headers.append(("X-Site-Version", "0.1.104"))
        for answer in (named("v0.1.104"), named("latest"), named("0.1"), named(" "), twice):
            with self.subTest(sent=answer.all("x-site-version")):
                code, output = self.live(answer)
                self.assertEqual(code, 1, output)
                self.assertIn("X-Site-Version must name one X.Y.Z release", output)

    def test_a_site_naming_no_release_passes_only_as_the_exact_headerless_bundle(self) -> None:
        asked: list[str] = []

        def build(repository: Path, tag: str) -> set[str]:
            asked.append(tag)
            return {"/assets/index.js", "/assets/index.css"}

        bare = {"Cross_Origin_Opener_Policy": None, "Permissions_Policy": None}
        code, output = self.live(named(None, **bare), build=build)
        self.assertEqual(code, 0, output)
        self.assertEqual(asked, ["v0.1.103"])
        self.assertIn("deployed release 0.1.103, identified by its bundle, which is exactly v0.1.103's", output)
        for built in ({"/assets/index.js"}, {"/assets/index.js", "/assets/index.css", "/assets/font.woff2"}, set()):
            with self.subTest(built=sorted(built)):
                code, output = self.live(named(None, **bare), build=lambda repository, tag: built)
                self.assertEqual(code, 1, output)
                self.assertIn("names no release and does not serve the v0.1.103 bundle", output)

        def broken(repository: Path, tag: str) -> set[str]:
            raise LookupError("building the v0.1.103 bundle failed at npm ci: offline")

        code, output = self.live(named(None, **bare), build=broken)
        self.assertEqual(code, 1, output)
        self.assertIn("the deployed release cannot be judged: building the v0.1.103 bundle failed", output)

    def test_production_may_trail_main_for_a_day_and_no_longer(self) -> None:
        # Written in hours, not read from the constant, so a wider bound fails.
        code, output = self.live(named("0.1.103"), now=MAIN_CHANGED + 23 * HOUR)
        self.assertEqual(code, 0, output)
        self.assertIn("production runs 0.1.103, behind main's 0.1.104 for 23.0 h (bound 24 h)", output)
        code, output = self.live(named("0.1.103"), now=MAIN_CHANGED + 25 * HOUR)
        self.assertEqual(code, 1, output)
        self.assertIn("the release main cut has not reached production", output)
        # At main's release, any delay is fine.
        self.assertEqual(self.live(named("0.1.104"), now=MAIN_CHANGED + 400 * HOUR)[0], 0)

    def test_an_unreadable_main_fails(self) -> None:
        code, output = self.live(named("0.1.104"), repository=self.no_main)
        self.assertEqual(code, 1, output)
        self.assertIn("main's VERSION cannot be read from origin/main", output)


# Past the byte cap, the review's reproduction: the compliant page padded to
# exactly the cap, then an undeclared inline script only a complete read sees.
PAST_CAP = HTML.encode().ljust(gate.BODY_CAP_BYTES) + b"<script>window.reviewProbe=1</script>"


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - the stdlib names it
        status = 404 if self.path == "/missing" else 200
        body = {
            "/at-cap": HTML.encode().ljust(gate.BODY_CAP_BYTES),
            "/past-cap": PAST_CAP,
        }.get(self.path, HTML.encode())
        # "/cut-short" promises more bytes than it sends, then closes.
        promised = len(body) + (100 if self.path == "/cut-short" else 0)
        self.send_response(status)
        for key, value in headers():
            self.send_header(key, value)
        self.send_header("Content-Length", str(promised))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        return


class LiveModeTests(unittest.TestCase):
    """The fetch layer and `live` end to end, against a loopback server."""

    def setUp(self) -> None:
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.addCleanup(self.server.server_close)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def test_fetch_keeps_an_error_answer_instead_of_raising(self) -> None:
        answer = gate.fetch(self.base + "/missing")
        self.assertEqual(answer.status, 404)
        self.assertEqual(answer.first("x-frame-options"), "DENY")

    def test_live_mode_passes_the_compliant_site_and_fails_a_regression(self) -> None:
        code, output = self.live("/")
        self.assertEqual(code, 0, output)
        self.assertIn("START mode=live", output)
        self.assertIn("decision=pass refusals=0 version=0.1.104", output)
        code, output = self.live("/", drop="cross-origin-opener-policy")
        self.assertEqual(code, 1, output)
        self.assertIn("decision=fail refusals=1", output)

    def test_live_mode_fails_closed_when_the_site_cannot_be_read(self) -> None:
        for error in (OSError("connection refused"), http.client.IncompleteRead(b"", 100)):
            with self.subTest(error=type(error).__name__):

                def unreachable(url: str) -> gate.Fetched:
                    raise error

                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(gate.run_live(gate.MANIFEST, fetcher=unreachable), 1)
                self.assertIn("could not be read", output.getvalue())

    def live(self, path: str, drop: str | None = None) -> tuple[int, str]:
        """`live` with the site, naming 0.1.104, served at `path`."""
        base = self.base

        def fetcher(url: str) -> gate.Fetched:
            answer = gate.fetch(base + path)
            kept = [(key, value) for key, value in answer.headers if key.lower() != drop]
            return gate.Fetched(url, answer.status, [*kept, ("X-Site-Version", "0.1.104")], answer.body)

        with tempfile.TemporaryDirectory() as scratch:
            repository = Releases(Path(scratch) / "releases").root
            head = Path(scratch) / "compliance.json"
            head.write_text(json.dumps(manifest()))
            output = io.StringIO()
            with redirect_stdout(output):
                code = gate.run_live(
                    head, fetcher=fetcher, repository=repository, build=no_build,
                    now=lambda: MAIN_CHANGED,
                )
        return code, output.getvalue()

    def test_an_answer_past_the_byte_cap_is_refused_not_judged_by_its_prefix(self) -> None:
        # Judged whole, the answer is refused for the script past the cap.
        whole = gate.judge(manifest(), gate.Fetched(SITE, 200, headers(), PAST_CAP), {})
        self.assertTrue(any("inline script this repository did not build" in r for r in whole.refusals), whole.refusals)
        with self.assertRaisesRegex(ValueError, f"larger than the {gate.BODY_CAP_BYTES}-byte cap"):
            gate.fetch(self.base + "/past-cap")
        code, output = self.live("/past-cap")
        self.assertEqual(code, 1, output)
        self.assertIn("could not be read", output)
        # The cap itself is still a complete answer.
        self.assertEqual(len(gate.fetch(self.base + "/at-cap").body), gate.BODY_CAP_BYTES)
        self.assertEqual(self.live("/at-cap")[0], 0)

    def test_an_answer_shorter_than_its_content_length_is_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "declared [0-9]+ bytes and delivered [0-9]+"):
            gate.fetch(self.base + "/cut-short")
        code, output = self.live("/cut-short")
        self.assertEqual(code, 1, output)
        self.assertIn("could not be read", output)



HEAD = json.loads(gate.MANIFEST.read_text(encoding="utf-8"))
HEAD_VERSION = gate.VERSION_FILE.read_text(encoding="utf-8").strip()
# The page as the origin builds it: no edge, so no injected script.
ORIGIN_HTML = HTML.replace(INJECTED, "")


class _Origin(http.server.BaseHTTPRequestHandler):
    """The head's image as the candidate check meets it: every header the head
    manifest declares, its VERSION named, and HSTS only when the request says
    it arrived over TLS, the way `securityHeaders` decides."""

    def do_GET(self) -> None:  # noqa: N802 - the stdlib names it
        server = self.server
        sent = {**HEAD["headers"], "x-site-version": HEAD_VERSION, "content-type": "text/html; charset=utf-8"}
        if self.headers.get("X-Forwarded-Proto") == "https":
            sent["strict-transport-security"] = "max-age=31536000"
        sent.update(server.changes)  # type: ignore[attr-defined]
        body = (server.html if self.path == "/" else "<!doctype html><title>privacy</title>").encode()  # type: ignore[attr-defined]
        self.send_response(200)
        for key, value in sent.items():
            if value is not None:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        return


class CandidateModeTests(unittest.TestCase):
    """`candidate`: this head's image held strictly to this head's manifest."""

    def setUp(self) -> None:
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Origin)
        self.server.changes = {}  # type: ignore[attr-defined]
        self.server.html = ORIGIN_HTML  # type: ignore[attr-defined]
        self.addCleanup(self.server.server_close)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.shutdown)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/"

    def candidate(self, url: str | None = None, **changes: str | None) -> tuple[int, str]:
        self.server.changes = {name.replace("_", "-").lower(): value for name, value in changes.items()}  # type: ignore[attr-defined]
        output = io.StringIO()
        with redirect_stdout(output):
            code = gate.run_candidate(gate.MANIFEST, url or self.url)
        return code, output.getvalue()

    def test_the_head_manifest_declares_the_promises_this_release_makes(self) -> None:
        self.assertEqual(HEAD["schema"], "compliance/v2")
        self.assertEqual(HEAD["headers"]["cross-origin-opener-policy"], "same-origin")
        self.assertEqual(
            HEAD["headers"]["content-security-policy"],
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; "
            "connect-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; "
            "object-src 'none'",
        )

    def test_an_image_that_sends_what_the_head_declares_passes(self) -> None:
        code, output = self.candidate()
        self.assertEqual(code, 0, output)
        self.assertIn(f"decision=pass refusals=0 version={HEAD_VERSION}", output)

    def test_an_image_missing_any_promise_is_refused(self) -> None:
        policy = HEAD["headers"]["permissions-policy"]
        cases = {
            "no opener policy": {"Cross_Origin_Opener_Policy": None},
            "payment admitted": {"Permissions_Policy": policy.replace("payment=(), ", "")},
            "usb admitted": {"Permissions_Policy": policy.replace(", usb=()", "")},
        }
        csp = HEAD["headers"]["content-security-policy"]
        directives = [part.strip() for part in csp.split(";")]
        self.assertEqual(len(directives), 11)
        for directive in directives:
            cases[f"CSP without {directive.split()[0]}"] = {
                "Content_Security_Policy": "; ".join(other for other in directives if other != directive)
            }
        for name, changes in cases.items():
            with self.subTest(name):
                code, output = self.candidate(**changes)
                self.assertEqual(code, 1, output)
                self.assertIn("REFUSE the manifest declares ", output)

    def test_an_image_must_name_the_head_release(self) -> None:
        for sent, shown in ((None, "nothing"), ("0.1.103", "0.1.103")):
            with self.subTest(sent=sent):
                code, output = self.candidate(X_Site_Version=sent)
                self.assertEqual(code, 1, output)
                self.assertIn(f"must name its release as X-Site-Version: {HEAD_VERSION}; it sent {shown}", output)

    def test_no_edge_observation_exempts_the_candidate(self) -> None:
        # Behind the edge this script is a declared observation; from the
        # image itself it is a script this repository did not build.
        self.server.html = HTML  # type: ignore[attr-defined]
        code, output = self.candidate()
        self.assertEqual(code, 1, output)
        self.assertIn("inline script this repository did not build", output)

    def test_hsts_is_judged_as_the_edge_would_ask_for_it(self) -> None:
        # The check states X-Forwarded-Proto: https, so a missing promise is
        # the image's, not the request's.
        code, output = self.candidate(Strict_Transport_Security="max-age=60")
        self.assertEqual(code, 1, output)
        self.assertIn("Strict-Transport-Security must carry max-age", output)

    def test_the_candidate_runs_only_on_loopback(self) -> None:
        for url in ("https://naranjo.online/", "http://localhost:8080/", "http://127.0.0.1:8080/x"):
            with self.subTest(url=url):
                code, output = self.candidate(url=url)
                self.assertEqual(code, 1, output)
                self.assertIn("the candidate URL must be http://127.0.0.1:<port>/", output)


if __name__ == "__main__":
    unittest.main()
