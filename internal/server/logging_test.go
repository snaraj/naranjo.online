// logging_test proves the request-observability layer: one record per
// request with the completion facts, injection-safe correlation identity,
// W3C trace passthrough, privacy pins (no query strings, no client address),
// status-class level mapping, panic reporting, and — critically for the
// media path — that the recorder stays transparent to
// http.ResponseController so the idle write deadline still reaches the
// connection through it.
package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/snaraj/naranjo.online/internal/testsupport"
)

// generatedIdentityShape is the exact form of a minted request id: 16 random
// bytes as 32 lowercase hex characters.
var generatedIdentityShape = regexp.MustCompile(`^[0-9a-f]{32}$`)

// captureSite builds a logging site over the canonical frontend fixture with
// a JSON logger at the given level, returning the site and the buffer its
// records land in.
func captureSite(t *testing.T, level slog.Level) (*Site, *bytes.Buffer) {
	t.Helper()
	var out bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&out, &slog.HandlerOptions{Level: level}))
	site, err := New(testsupport.FrontendFS(), WithLogger(logger))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return site, &out
}

// logRecords decodes one JSON record per non-empty line.
func logRecords(t *testing.T, output string) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("log line is not one JSON object: %v\nline: %q", err, line)
		}
		records = append(records, record)
	}
	return records
}

// singleRecord asserts exactly one record was emitted and returns it.
func singleRecord(t *testing.T, output string) map[string]any {
	t.Helper()
	records := logRecords(t, output)
	if len(records) != 1 {
		t.Fatalf("emitted %d records, want exactly 1:\n%s", len(records), output)
	}
	return records[0]
}

// TestRequestLogRecordsEveryOutcomeClass drives the complete production
// handler chain and pins the completion record for each response class the
// site actually produces — success, hidden 404, ambiguous-path rejection,
// and the TLS redirect — plus the privacy pins: the record carries the URL
// path only (never the query string) and no client address.
func TestRequestLogRecordsEveryOutcomeClass(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		target     string
		proto      string
		wantStatus float64
		wantLevel  string
		wantPath   string
		wantBytes  bool
	}{
		"document success":         {target: "/?token=hunter2secret", wantStatus: 200, wantLevel: "INFO", wantPath: "/", wantBytes: true},
		"hidden path 404":          {target: "/missing", wantStatus: 404, wantLevel: "WARN", wantPath: "/missing", wantBytes: true},
		"ambiguous path rejection": {target: "//etc/passwd", wantStatus: 404, wantLevel: "WARN", wantPath: "//etc/passwd", wantBytes: true},
		"forwarded-http redirect":  {target: "/", proto: "http", wantStatus: 308, wantLevel: "INFO", wantPath: "/"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			site, out := captureSite(t, slog.LevelInfo)
			request := httptest.NewRequest(http.MethodGet, testCase.target, nil)
			if testCase.proto != "" {
				request.Header.Set("X-Forwarded-Proto", testCase.proto)
			}
			response := httptest.NewRecorder()
			site.ServeHTTP(response, request)

			record := singleRecord(t, out.String())
			if record["msg"] != "request served" || record["level"] != testCase.wantLevel {
				t.Errorf("record msg/level = %v/%v, want request served/%s", record["msg"], record["level"], testCase.wantLevel)
			}
			if record["http.response.status_code"] != testCase.wantStatus || record["url.path"] != testCase.wantPath || record["http.request.method"] != "GET" {
				t.Errorf("record = status %v path %v method %v, want %v %q GET", record["http.response.status_code"], record["url.path"], record["http.request.method"], testCase.wantStatus, testCase.wantPath)
			}
			if record["network.protocol.version"] != "1.1" {
				t.Errorf("network.protocol.version = %v, want 1.1", record["network.protocol.version"])
			}
			if _, ok := record["duration_ms"].(float64); !ok {
				t.Errorf("duration_ms = %v, want a number", record["duration_ms"])
			}
			bodyBytes, ok := record["http.response.body.size"].(float64)
			if !ok || (testCase.wantBytes && bodyBytes <= 0) {
				t.Errorf("bytes = %v, want a positive count for a body-bearing response", record["http.response.body.size"])
			}
			identity, _ := record["request_id"].(string)
			if !generatedIdentityShape.MatchString(identity) {
				t.Errorf("request_id = %q, want a generated 32-hex identity", identity)
			}
			if got := response.Header().Get("X-Request-Id"); got != identity {
				t.Errorf("response X-Request-Id = %q, want the logged %q", got, identity)
			}
			// Privacy pins: the query string and the client address must not
			// appear anywhere in the record.
			if strings.Contains(out.String(), "hunter2secret") {
				t.Error("query string reached the log record; only the URL path may be logged")
			}
			if strings.Contains(out.String(), request.RemoteAddr) || strings.Contains(out.String(), "192.0.2.1") {
				t.Error("client address reached the log record; no client IP is ever logged")
			}
		})
	}
}

// TestRequestIdentityHonorsOnlyTheSafeShape pins the injection boundary on
// the correlation id: the exact safe shape is echoed, and every hostile or
// malformed inbound value is REPLACED by a generated identity — never
// sanitized, never partially reused.
func TestRequestIdentityHonorsOnlyTheSafeShape(t *testing.T) {
	t.Parallel()
	t.Run("safe inbound ids are honored end to end", func(t *testing.T) {
		t.Parallel()
		for _, id := range []string{"a", "edge-7f3B_2", strings.Repeat("x", 64)} {
			site, out := captureSite(t, slog.LevelInfo)
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.Header.Set("X-Request-Id", id)
			response := httptest.NewRecorder()
			site.ServeHTTP(response, request)
			record := singleRecord(t, out.String())
			if record["request_id"] != id || response.Header().Get("X-Request-Id") != id {
				t.Errorf("safe id %q was not honored: logged %v, header %q", id, record["request_id"], response.Header().Get("X-Request-Id"))
			}
		}
	})
	t.Run("hostile inbound ids are replaced wholesale", func(t *testing.T) {
		t.Parallel()
		for name, hostile := range map[string]string{
			"empty":              "",
			"over length":        strings.Repeat("x", 65),
			"embedded newline":   "evil\nlevel=ERROR msg=forged",
			"ansi escape":        "\x1b[2Jwiped",
			"space separated":    "two words",
			"header injection":   "id\r\nSet-Cookie: p=1",
			"percent and slash":  "id%0a/../../etc",
			"unicode lookalikes": "идентификатор",
		} {
			t.Run(name, func(t *testing.T) {
				t.Parallel()
				site, out := captureSite(t, slog.LevelInfo)
				request := httptest.NewRequest(http.MethodGet, "/", nil)
				request.Header["X-Request-Id"] = []string{hostile}
				response := httptest.NewRecorder()
				site.ServeHTTP(response, request)
				record := singleRecord(t, out.String())
				identity, _ := record["request_id"].(string)
				if !generatedIdentityShape.MatchString(identity) {
					t.Fatalf("hostile id %q produced request_id %q, want a generated 32-hex identity", hostile, identity)
				}
				if response.Header().Get("X-Request-Id") != identity {
					t.Errorf("response header %q disagrees with logged id %q", response.Header().Get("X-Request-Id"), identity)
				}
				if hostile != "" && strings.Contains(out.String(), hostile) {
					t.Errorf("hostile inbound id %q reached the log stream", hostile)
				}
			})
		}
	})
}

// TestHostileHeadersCannotSplitOrForgeRecords is the log-injection proof for
// BOTH handler formats: a header carrying newlines and ANSI escapes must
// yield exactly one record whose hostile bytes are encoded, so no inbound
// value can fabricate a second record or drive a reader's terminal.
func TestHostileHeadersCannotSplitOrForgeRecords(t *testing.T) {
	t.Parallel()
	hostileAgent := "probe\x1b[2J\nlevel=INFO msg=\"forged record\"\n{\"level\":\"INFO\",\"msg\":\"forged json\"}"
	for name, build := range map[string]func(out *bytes.Buffer) *slog.Logger{
		"json handler": func(out *bytes.Buffer) *slog.Logger {
			return slog.New(slog.NewJSONHandler(out, &slog.HandlerOptions{Level: slog.LevelDebug}))
		},
		"text handler": func(out *bytes.Buffer) *slog.Logger {
			return slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{Level: slog.LevelDebug}))
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var out bytes.Buffer
			site, err := New(testsupport.FrontendFS(), WithLogger(build(&out)))
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.Header.Set("User-Agent", hostileAgent)
			request.Header["X-Request-Id"] = []string{"evil\nid"}
			site.ServeHTTP(httptest.NewRecorder(), request)

			output := out.String()
			if lines := strings.Count(output, "\n"); lines != 1 {
				t.Fatalf("hostile headers produced %d lines, want exactly 1 record:\n%s", lines, output)
			}
			if strings.Contains(output, "\x1b") {
				t.Error("a raw ANSI escape byte reached the log stream")
			}
			if strings.Contains(output, "\n{\"level\"") || strings.HasPrefix(output, "level=INFO msg=\"forged record\"") {
				t.Error("hostile header bytes forged a record boundary")
			}
		})
	}
}

// TestTraceparentPassthroughAndTraceIDLogging pins the mesh-ready contract:
// a valid W3C traceparent is left untouched on the request, its trace-id
// lands in the record as the OTel TraceId, and its parent-id lands ONLY
// under the custom parent_span_id — never as an OTel span_id, because the
// parent-id names the CALLER's span and this origin produces no spans
// (W3C trace-context §parent-id; OTel logs data model §SpanId). Every
// invalid shape — wrong version, zero ids, uppercase hex, truncation —
// yields none of the three attributes.
func TestTraceparentPassthroughAndTraceIDLogging(t *testing.T) {
	t.Parallel()
	const valid = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	t.Run("valid header logs trace id and custom parent span id, never an OTel span id", func(t *testing.T) {
		t.Parallel()
		site, out := captureSite(t, slog.LevelInfo)
		request := httptest.NewRequest(http.MethodGet, "/", nil)
		request.Header.Set("Traceparent", valid)
		site.ServeHTTP(httptest.NewRecorder(), request)
		record := singleRecord(t, out.String())
		if record["trace_id"] != "4bf92f3577b34da6a3ce929d0e0e4736" {
			t.Errorf("trace_id = %v, want the header's trace-id field", record["trace_id"])
		}
		if record["parent_span_id"] != "00f067aa0ba902b7" {
			t.Errorf("parent_span_id = %v, want the header's parent-id field", record["parent_span_id"])
		}
		if _, present := record["span_id"]; present {
			t.Errorf("record carries span_id %v; an origin that mints no spans must emit no OTel SpanId", record["span_id"])
		}
		if got := request.Header.Get("Traceparent"); got != valid {
			t.Errorf("traceparent was modified to %q; passthrough must leave it untouched", got)
		}
	})
	t.Run("invalid headers log no trace id", func(t *testing.T) {
		t.Parallel()
		for name, header := range map[string]string{
			"forbidden version ff": "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
			"all-zero trace id":    "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
			"all-zero parent id":   "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
			"uppercase hex":        "00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01",
			"truncated":            "00-4bf92f3577b34da6-00f067aa0ba902b7-01",
			"garbage":              "not-a-traceparent",
			"empty":                "",
		} {
			t.Run(name, func(t *testing.T) {
				t.Parallel()
				site, out := captureSite(t, slog.LevelInfo)
				request := httptest.NewRequest(http.MethodGet, "/", nil)
				if header != "" {
					request.Header.Set("Traceparent", header)
				}
				site.ServeHTTP(httptest.NewRecorder(), request)
				record := singleRecord(t, out.String())
				if record["trace_id"] != nil || record["span_id"] != nil || record["parent_span_id"] != nil {
					t.Errorf("invalid traceparent %q logged trace_id %v span_id %v parent_span_id %v, want none", header, record["trace_id"], record["span_id"], record["parent_span_id"])
				}
			})
		}
	})
}

// TestUserAgentIsADebugOnlyAttribute pins the privacy default: routine
// records carry no User-Agent; only an operator explicitly running at debug
// sees it.
func TestUserAgentIsADebugOnlyAttribute(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		level slog.Level
		want  bool
	}{
		"info level omits the user agent":    {level: slog.LevelInfo, want: false},
		"debug level carries the user agent": {level: slog.LevelDebug, want: true},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			site, out := captureSite(t, testCase.level)
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.Header.Set("User-Agent", "probe-agent/1.0")
			site.ServeHTTP(httptest.NewRecorder(), request)
			record := singleRecord(t, out.String())
			if _, present := record["user_agent.original"]; present != testCase.want {
				t.Errorf("user_agent present = %t at %v, want %t", present, testCase.level, testCase.want)
			}
		})
	}
}

// TestRequestLogMapsStatusClassesToLevels drives the middleware directly
// with stub handlers so every class — including the 5xx no production route
// returns on demand — is proven: 2xx/3xx inform, 4xx warn, 5xx error, and a
// handler that writes nothing records net/http's implicit 200.
func TestRequestLogMapsStatusClassesToLevels(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		handler   http.HandlerFunc
		wantLevel string
		wantCode  float64
	}{
		"explicit 204": {handler: func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }, wantLevel: "INFO", wantCode: 204},
		"redirect 308": {handler: func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusPermanentRedirect) }, wantLevel: "INFO", wantCode: 308},
		"client error 416": {handler: func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "range", http.StatusRequestedRangeNotSatisfiable)
		}, wantLevel: "WARN", wantCode: 416},
		"server error 500": {handler: func(w http.ResponseWriter, r *http.Request) { http.Error(w, "boom", http.StatusInternalServerError) }, wantLevel: "ERROR", wantCode: 500},
		"server error 503": {handler: func(w http.ResponseWriter, r *http.Request) { http.Error(w, "busy", http.StatusServiceUnavailable) }, wantLevel: "ERROR", wantCode: 503},
		"implicit 200":     {handler: func(w http.ResponseWriter, r *http.Request) {}, wantLevel: "INFO", wantCode: 200},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var out bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&out, nil))
			handler := requestLog(logger, testCase.handler)
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/probe", nil))
			record := singleRecord(t, out.String())
			if record["level"] != testCase.wantLevel || record["http.response.status_code"] != testCase.wantCode {
				t.Errorf("record level/status = %v/%v, want %s/%v", record["level"], record["http.response.status_code"], testCase.wantLevel, testCase.wantCode)
			}
		})
	}
}

// TestRequestLogReportsPanicsAndRepanics pins the 5xx-with-error contract on
// the one path that carries a known error: a panicking handler is logged at
// ERROR with the panic value as the record's error, and the panic is
// re-raised so net/http's teardown semantics stay intact.
func TestRequestLogReportsPanicsAndRepanics(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&out, nil))
	handler := requestLog(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom-sentinel")
	}))
	repanicked := func() (repanicked bool) {
		defer func() {
			if recover() != nil {
				repanicked = true
			}
		}()
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/probe", nil))
		return false
	}()
	if !repanicked {
		t.Fatal("requestLog swallowed the handler panic; net/http must still see it")
	}
	record := singleRecord(t, out.String())
	if record["msg"] != "request failed" || record["level"] != "ERROR" {
		t.Errorf("panic record msg/level = %v/%v, want request failed/ERROR", record["msg"], record["level"])
	}
	if errText, _ := record["error"].(string); !strings.Contains(errText, "boom-sentinel") {
		t.Errorf("panic record error = %v, want the panic value", record["error"])
	}
	if record["http.response.status_code"] != float64(0) {
		t.Errorf("panic record status = %v, want the honest 0 for a response never sent", record["http.response.status_code"])
	}
}

// deadlineCapturingWriter is the connection-shaped base of the wrapper-chain
// proof: it records every write deadline that reaches it, exactly what a
// real *http.response would forward to the TCP connection.
type deadlineCapturingWriter struct {
	http.ResponseWriter
	deadlines []time.Time
}

func (w *deadlineCapturingWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}

// TestResponseRecorderStaysResponseControllerCompatible is the explicit
// wrapper-chain proof: with the logging recorder BETWEEN the media path's
// idleDeadlineWriter and the connection, http.ResponseController must still
// reach SetWriteDeadline — through both Unwraps — and the recorder must
// still count the bytes the media copy writes. This is the regression test
// for the exact composition production now runs.
func TestResponseRecorderStaysResponseControllerCompatible(t *testing.T) {
	t.Parallel()
	base := &deadlineCapturingWriter{ResponseWriter: httptest.NewRecorder()}
	recorder := &responseRecorder{ResponseWriter: base}
	idle := &idleDeadlineWriter{ResponseWriter: recorder, timeout: mediaWriteIdleTimeout}

	if err := http.NewResponseController(idle).SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("SetWriteDeadline through recorder+idleDeadlineWriter = %v, want nil", err)
	}
	if len(base.deadlines) != 1 {
		t.Fatalf("connection received %d deadlines, want 1: the recorder broke the Unwrap chain", len(base.deadlines))
	}
	if _, err := idle.Write([]byte("chunk")); err != nil {
		t.Fatalf("Write through the chain = %v", err)
	}
	if len(base.deadlines) != 2 {
		t.Errorf("connection received %d deadlines after a write, want 2 (idle refresh per chunk)", len(base.deadlines))
	}
	if recorder.bytes != 5 || recorder.status != http.StatusOK {
		t.Errorf("recorder captured %d bytes / status %d, want 5 / 200", recorder.bytes, recorder.status)
	}
}

// TestMediaRangeAbuseLogsWarnWithRequestID pins the observability half of
// the media range-abuse defense: the 416 refusal is a WARN record carrying
// the request identity, so an abuse pattern is visible and correlatable in
// `kubectl logs` without any media-code change.
func TestMediaRangeAbuseLogsWarnWithRequestID(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&out, nil))
	site, err := NewWithMedia(testsupport.FrontendFS(), MediaOptions{Root: testsupport.MediaRoot(t), MaxConcurrent: 2}, WithLogger(logger))
	if err != nil {
		t.Fatalf("NewWithMedia() error = %v", err)
	}
	defer site.Close()

	target := "/media/immutable/" + testsupport.MediaDigest + "/clip.mp4"
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("Range", "bytes="+strings.Repeat("0-0,", maxRangeParts+1)+"0-0")
	response := httptest.NewRecorder()
	site.ServeHTTP(response, request)
	if response.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("abusive Range status = %d, want 416", response.Code)
	}
	record := singleRecord(t, out.String())
	if record["level"] != "WARN" || record["http.response.status_code"] != float64(416) || record["url.path"] != target {
		t.Errorf("record = level %v status %v path %v, want WARN 416 %q", record["level"], record["http.response.status_code"], record["url.path"], target)
	}
	identity, _ := record["request_id"].(string)
	if !generatedIdentityShape.MatchString(identity) {
		t.Errorf("range-abuse record request_id = %q, want a generated identity", identity)
	}
}

// TestSiteWithoutALoggerStaysQuietAndServes pins the default: construction
// without WithLogger serves identically and writes nothing anywhere — the
// property every pre-existing suite in this repository now relies on.
func TestSiteWithoutALoggerStaysQuietAndServes(t *testing.T) {
	t.Parallel()
	site, err := New(testsupport.FrontendFS())
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	response := httptest.NewRecorder()
	site.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET / without a logger = %d, want 200", response.Code)
	}
	if response.Header().Get("X-Request-Id") == "" {
		t.Error("correlation header missing without a logger; identity minting must not depend on logging")
	}
}

// TestWithLoggerNilFailsClosedToQuiet pins the nil-injection edge: an
// explicit nil logger resolves to the discard default instead of panicking
// the first request.
func TestWithLoggerNilFailsClosedToQuiet(t *testing.T) {
	t.Parallel()
	site, err := New(testsupport.FrontendFS(), WithLogger(nil))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	response := httptest.NewRecorder()
	site.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET / with a nil logger = %d, want 200", response.Code)
	}
}

// TestGeneratedIdentitiesAreUnique is the cheap sanity bound on the minting
// path: a burst of generated ids must not collide, or correlation would
// silently merge unrelated requests.
func TestGeneratedIdentitiesAreUnique(t *testing.T) {
	t.Parallel()
	seen := make(map[string]struct{}, 256)
	for i := 0; i < 256; i++ {
		identity := requestIdentity(fmt.Sprintf("bad id %d", i))
		if !generatedIdentityShape.MatchString(identity) {
			t.Fatalf("generated identity %q is not 32 lowercase hex", identity)
		}
		if _, dup := seen[identity]; dup {
			t.Fatalf("generated identity %q collided within 256 mints", identity)
		}
		seen[identity] = struct{}{}
	}
}
