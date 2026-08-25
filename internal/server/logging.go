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
			attrs := make([]slog.Attr, 0, 10)
			attrs = append(attrs,
				slog.String("request_id", identity),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", status),
				slog.Float64("duration_ms", float64(time.Since(start))/float64(time.Millisecond)),
				slog.Int64("bytes", recorder.bytes),
				slog.String("proto", r.Proto),
			)
			if traceID, spanID := traceContext(r.Header.Get(traceparentHeader)); traceID != "" {
				// Named for the OpenTelemetry log data model's TraceId/SpanId
				// pair: span_id is the traceparent's parent-id — the caller's
				// span, the closest honest correlate an origin that mints no
				// spans of its own can report. A collector reading this
				// stream can attach every record to the distributed trace
				// with no SDK in the binary.
				attrs = append(attrs, slog.String("trace_id", traceID), slog.String("span_id", spanID))
			}
			// The User-Agent is a debugging detail, not routine telemetry: it
			// rides only when the operator explicitly runs at debug.
			if logger.Enabled(r.Context(), slog.LevelDebug) {
				attrs = append(attrs, slog.String("user_agent", r.UserAgent()))
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
// modified — mesh-ready passthrough with no tracing dependency — and the
// two values land in the record as the OTel log data model's TraceId/SpanId
// correlation pair.
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
