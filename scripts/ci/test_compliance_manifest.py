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
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import compliance_manifest as gate

SITE = "https://site.example/"
REPORTS = "https://reports.example"
MARKER = "/edge-injected/"


def manifest() -> dict:
    return {
        "schema": "compliance/v1",
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
        "Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
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
    def assertRefused(self, verdict: gate.Verdict, fragment: str) -> None:
        self.assertTrue(
            any(fragment in refusal for refusal in verdict.refusals),
            f"expected a refusal containing {fragment!r}, got {verdict.refusals}",
        )

    def test_the_compliant_baseline_passes(self) -> None:
        verdict = gate.judge(manifest(), document(), {})
        self.assertEqual(verdict.refusals, [])
        self.assertIn(f"declared injected script seen: {MARKER}", verdict.notes)

    def test_a_non_200_document_is_refused(self) -> None:
        self.assertRefused(gate.judge(manifest(), document(status=403), {}), "answered 403")

    def test_a_missing_csp_is_refused(self) -> None:
        self.assertRefused(gate.judge(manifest(), document(Content_Security_Policy=None), {}), "no Content-Security-Policy")

    def test_a_csp_without_default_src_is_refused(self) -> None:
        verdict = gate.judge(manifest(), document(Content_Security_Policy="script-src 'self'; frame-ancestors 'none'"), {})
        self.assertRefused(verdict, "no default-src")

    def test_an_undeclared_origin_in_any_fetch_directive_is_refused_with_its_lift(self) -> None:
        for directive in ("script-src", "font-src", "connect-src", "img-src", "style-src", "frame-src"):
            with self.subTest(directive=directive):
                csp = f"default-src 'self'; {directive} 'self' https://cdn.example; frame-ancestors 'none'"
                verdict = gate.judge(manifest(), document(Content_Security_Policy=csp), {})
                self.assertRefused(verdict, f"{directive} admits the undeclared origin https://cdn.example")
                self.assertRefused(verdict, '"origin": "https://cdn.example"')

    def test_a_declared_origin_passes_and_an_unused_declaration_is_stale(self) -> None:
        declared = manifest()
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
                self.assertRefused(gate.judge(manifest(), document(Content_Security_Policy=csp), {}), fragment)

    def test_data_images_are_ordinary(self) -> None:
        csp = "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
        self.assertEqual(gate.judge(manifest(), document(Content_Security_Policy=csp), {}).refusals, [])

    def test_inline_or_eval_script_sources_are_refused_but_hashes_pass(self) -> None:
        for source, fragment in (
            ("'unsafe-inline'", "runs code no file of this repository shipped"),
            ("'unsafe-eval'", "runs code no file of this repository shipped"),
            ("'strict-dynamic'", "a keyword this gate does not admit"),
        ):
            with self.subTest(source=source):
                csp = f"default-src 'self'; script-src 'self' {source}; frame-ancestors 'none'"
                self.assertRefused(gate.judge(manifest(), document(Content_Security_Policy=csp), {}), fragment)
        # Inline style is not script: the gate leaves it to the CSP tests that own it.
        csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
        self.assertEqual(gate.judge(manifest(), document(Content_Security_Policy=csp), {}).refusals, [])
        # A hash names bytes, not a place, so it admits no origin. With no
        # exempted script on the page there is nothing it could let run.
        quiet = manifest()
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
                verdict = gate.judge(manifest(), document(html=html, Content_Security_Policy=csp), {})
                self.assertRefused(verdict, f"declared injected script marked {MARKER!r}, which this CSP can let run")
        # Every enforced policy must admit a script for it to run, so one
        # policy that blocks all inline code is enough to keep it inert.
        nonce = "default-src 'self'; script-src 'self' 'nonce-bm9uY2U='; frame-ancestors 'none'"
        both = [("Content-Security-Policy", nonce), *headers()]
        self.assertEqual(gate.judge(manifest(), gate.Fetched(SITE, 200, both, HTML.encode()), {}).refusals, [])
        # script-src-elem governs <script> elements, so a nonce confined to
        # attribute handlers leaves the element blocked.
        attr = "default-src 'self'; script-src-attr 'nonce-bm9uY2U='; frame-ancestors 'none'"
        self.assertEqual(gate.judge(manifest(), document(Content_Security_Policy=attr), {}).refusals, [])

    def test_framing_must_be_denied_somewhere(self) -> None:
        csp = "default-src 'self'"
        self.assertRefused(gate.judge(manifest(), document(Content_Security_Policy=csp, X_Frame_Options=None), {}), "framing")
        self.assertEqual(gate.judge(manifest(), document(Content_Security_Policy=csp), {}).refusals, [])
        wide = "default-src 'self'; frame-ancestors https://other.example"
        self.assertRefused(gate.judge(manifest(), document(Content_Security_Policy=wide), {}), "frame-ancestors admits")

    def test_hsts_must_last_a_year(self) -> None:
        self.assertRefused(gate.judge(manifest(), document(Strict_Transport_Security="max-age=86400"), {}), "Strict-Transport-Security")
        self.assertRefused(gate.judge(manifest(), document(Strict_Transport_Security=None), {}), "Strict-Transport-Security")

    def test_nosniff_and_referrer_policy_are_required(self) -> None:
        self.assertRefused(gate.judge(manifest(), document(X_Content_Type_Options=None), {}), "nosniff")
        self.assertRefused(gate.judge(manifest(), document(Referrer_Policy="unsafe-url"), {}), "Referrer-Policy")
        self.assertRefused(gate.judge(manifest(), document(Referrer_Policy=None), {}), "Referrer-Policy")

    def test_a_cookie_on_the_document_is_refused(self) -> None:
        self.assertRefused(gate.judge(manifest(), document(Set_Cookie="tracker=1; Path=/"), {}), "'tracker'")

    def test_an_undeclared_reporting_endpoint_is_refused_and_a_vanished_one_is_stale(self) -> None:
        other = json.dumps({"group": "x", "endpoints": [{"url": "https://collector.example/r"}]})
        self.assertRefused(gate.judge(manifest(), document(Report_To=other), {}), "undeclared origin https://collector.example")
        self.assertRefused(gate.judge(manifest(), document(Report_To=other), {}), f"reporting endpoint {REPORTS}, which no longer occurs")
        endpoints = 'default="https://collector.example/r"'
        self.assertRefused(gate.judge(manifest(), document(Reporting_Endpoints=endpoints), {}), "https://collector.example")
        csp = "default-src 'self'; frame-ancestors 'none'; report-uri https://collector.example/csp"
        self.assertRefused(gate.judge(manifest(), document(Content_Security_Policy=csp), {}), "https://collector.example")

    def test_an_undeclared_inline_script_is_refused_and_a_vanished_one_is_stale(self) -> None:
        html = HTML.replace(MARKER, "/something-else/")
        verdict = gate.judge(manifest(), document(html=html), {})
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
                self.assertRefused(gate.judge(manifest(), document(html=html), {}), "loads")

    def test_a_published_legal_page_must_answer_html(self) -> None:
        published = manifest()
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
        changed["schema"] = "compliance/v2"
        self.assertIn("compliance.json schema must be 'compliance/v1'", self.refusals(changed))

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
        base = self.base

        def fetcher(url: str) -> gate.Fetched:
            answer = gate.fetch(base + "/" + url.split("/", 3)[3])
            return gate.Fetched(url, answer.status, answer.headers, answer.body)

        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / "compliance.json"
            value = json.loads(gate.MANIFEST.read_text(encoding="utf-8"))
            value["liveUrl"] = SITE
            value["edgeObservations"] = manifest()["edgeObservations"]
            path.write_text(json.dumps(value))
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(gate.run_live(path, fetcher=fetcher), 0, output.getvalue())
            self.assertIn("START mode=live", output.getvalue())
            self.assertIn("decision=pass", output.getvalue())

            value["edgeObservations"] = []
            path.write_text(json.dumps(value))
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(gate.run_live(path, fetcher=fetcher), 1)
            self.assertIn("decision=fail refusals=2", output.getvalue())

    def test_live_mode_fails_closed_when_the_site_cannot_be_read(self) -> None:
        for error in (OSError("connection refused"), http.client.IncompleteRead(b"", 100)):
            with self.subTest(error=type(error).__name__):

                def unreachable(url: str) -> gate.Fetched:
                    raise error

                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(gate.run_live(gate.MANIFEST, fetcher=unreachable), 1)
                self.assertIn("could not be read", output.getvalue())

    def live(self, path: str) -> tuple[int, str]:
        """`live` against the compliant manifest, with the site served at `path`."""
        base = self.base

        def fetcher(url: str) -> gate.Fetched:
            answer = gate.fetch(base + path)
            return gate.Fetched(url, answer.status, answer.headers, answer.body)

        with tempfile.TemporaryDirectory() as scratch:
            manifest_path = Path(scratch) / "compliance.json"
            value = json.loads(gate.MANIFEST.read_text(encoding="utf-8"))
            value["liveUrl"] = SITE
            value["edgeObservations"] = manifest()["edgeObservations"]
            manifest_path.write_text(json.dumps(value))
            output = io.StringIO()
            with redirect_stdout(output):
                code = gate.run_live(manifest_path, fetcher=fetcher)
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


if __name__ == "__main__":
    unittest.main()
