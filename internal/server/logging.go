// logging.go is the request-observability layer: exactly one completion
// record per request, written through the injected logger, wrapped OUTSIDE
// the security-policy chain so every outcome — redirects, rejections, panel
// responses, media refusals — is captured with its final status.
//
// Privacy is structural here, not a filtering step: the record carries the
// URL path ONLY (never the query string, which can carry secrets), never a
// client address (the edge fronts the origin; a client IP is personal data
// this repository does not collect, requirement 12), and the User-Agent only
// when the operator explicitly runs at debug. Correlation is injection-safe:
// an inbound X-Request-Id is honored only when it matches a strict shape,
// and everything else is replaced by a fresh random identity, so hostile
// header bytes can never become a log's correlation key. A valid W3C
// traceparent is left untouched on the request and its trace-id is logged,
// which is the zero-dependency hook a future mesh/OTel exporter correlates
// against.
package server

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// WithLogger injects the logger the Site logs requests through. Absent this
// option construction falls back to a discard logger, which is what keeps
// every existing test boot silent by default.
func WithLogger(logger *slog.Logger) Option {
	return func(configured *siteOptions) { configured.logger = logger }
}

// siteConfiguration folds the options into their resolved values, failing
// closed to the discard logger so a nil injection can never panic a request.
func siteConfiguration(options []Option) siteOptions {
	configured := siteOptions{logger: discardLogger}
	for _, option := range options {
		option(&configured)
	}
	if configured.logger == nil {
		configured.logger = discardLogger
	}
	return configured
}

// requestLog wraps the complete handler chain in the completion record
// described above. Levels follow the outcome class: 2xx/3xx inform, 4xx
// warn (this is where the media range-abuse 416s and hidden-path 404s
// surface, each carrying its request_id), 5xx error. A handler panic is
// logged at error with the panic value as the record's error, then
// re-raised so net/http's connection teardown semantics stay exactly as
// they were.
func requestLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		identity := requestIdentity(r.Header.Get(requestIDHeader))
		w.Header().Set(requestIDHeader, identity)
		recorder := &responseRecorder{ResponseWriter: w}
		defer func() {
			failure := recover()
			status := recorder.status
			if failure == nil && status == 0 {
				// A handler that returned without writing is answered 200 by
				// net/http; a panicked one is not, so its record keeps the
				// honest 0 for "nothing was sent".
				status = http.StatusOK
			}
			// Attribute names follow OTel HTTP semantic conventions
			// (http.request.method, url.path, http.response.status_code,
			// http.response.body.size, network.protocol.version), so a
			// future collector ingests these records without remapping;
			// request_id and duration_ms are documented custom attributes.
			attrs := make([]slog.Attr, 0, 10)
			attrs = append(attrs,
				slog.String("request_id", identity),
				slog.String("http.request.method", r.Method),
				slog.String("url.path", r.URL.Path),
				slog.Int("http.response.status_code", status),
				slog.Float64("duration_ms", float64(time.Since(start))/float64(time.Millisecond)),
				slog.Int64("http.response.body.size", recorder.bytes),
				slog.String("network.protocol.version", strings.TrimPrefix(r.Proto, "HTTP/")),
			)
			if traceID, parentSpanID := traceContext(r.Header.Get(traceparentHeader)); traceID != "" {
				// trace_id is the record's OTel TraceId. The record carries
				// NO OTel span_id: the data model's SpanId names the span
				// this record was produced IN, this origin mints no spans,
				// and W3C defines the traceparent parent-id as the CALLER's
				// span — exporting it as span_id would misattribute origin
				// events to the caller (Daybreak finding, PR #184 round 1).
				// The caller's span survives under the clearly-custom
				// parent_span_id, which keeps the edge-to-origin linkage
				// debuggable without asserting a span this process never
				// created; a real span_id arrives only with a real local
				// span (phase 3, README "Observability contract").
				attrs = append(attrs, slog.String("trace_id", traceID), slog.String("parent_span_id", parentSpanID))
			}
			// The User-Agent is a debugging detail, not routine telemetry: it
			// rides only when the operator explicitly runs at debug, under
			// its semantic-convention name.
			if logger.Enabled(r.Context(), slog.LevelDebug) {
				attrs = append(attrs, slog.String("user_agent.original", r.UserAgent()))
			}
			if failure != nil {
				attrs = append(attrs, slog.Any("error", fmt.Errorf("handler panic: %v", failure)))
				logger.LogAttrs(r.Context(), slog.LevelError, "request failed", attrs...)
				panic(failure)
			}
			level := slog.LevelInfo
			switch {
			case status >= http.StatusInternalServerError:
				level = slog.LevelError
			case status >= http.StatusBadRequest:
				level = slog.LevelWarn
			}
			logger.LogAttrs(r.Context(), level, "request served", attrs...)
		}()
		next.ServeHTTP(recorder, r)
	})
}

// requestIdentity returns the correlation id for one request: the inbound
// X-Request-Id when — and only when — it matches the strict safe shape, and
// a fresh 16-byte random hex identity otherwise. Failing closed to a
// generated id (rather than sanitizing the hostile one) means no inbound
// byte outside [A-Za-z0-9_-] can ever reach a log record or a response
// header through this value.
func requestIdentity(inbound string) string {
	if inboundRequestIDShape.MatchString(inbound) {
		return inbound
	}
	identity := make([]byte, generatedRequestIDBytes)
	// crypto/rand.Read never returns an error (its Go 1.24+ contract; it
	// crashes the program on an unrecoverable platform failure instead).
	_, _ = rand.Read(identity)
	return hex.EncodeToString(identity)
}

// traceContext extracts the trace-id and parent span-id from a W3C
// traceparent header, or "","" when the header is absent or not exactly
// valid. Validation is fail-closed to the spec's version-00 shape:
// lowercase hex, exact field lengths, a version that is not the forbidden
// ff, and non-zero trace and parent ids. The header itself is never
// modified — mesh-ready passthrough with no tracing dependency. The
// trace-id lands in the record as the OTel TraceId; the parent-id lands
// as the custom parent_span_id, never as an OTel SpanId, because it names
// the CALLER's span and this origin produces no spans of its own.
func traceContext(value string) (string, string) {
	if !traceparentShape.MatchString(value) {
		return "", ""
	}
	version, traceID, parentID := value[:2], value[3:35], value[36:52]
	if version == "ff" || traceID == zeroTraceID || parentID == zeroParentID {
		return "", ""
	}
	return traceID, parentID
}

// Unwrap exposes the wrapped writer so http.ResponseController — and through
// it the media path's idle write deadline — keeps reaching the real
// connection through this recorder.
func (w *responseRecorder) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// WriteHeader records the first explicit status and forwards it unchanged.
func (w *responseRecorder) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

// Write counts the body bytes actually written and applies net/http's
// implicit-200 rule to the recorded status.
func (w *responseRecorder) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	written, err := w.ResponseWriter.Write(data)
	w.bytes += int64(written)
	return written, err
}
