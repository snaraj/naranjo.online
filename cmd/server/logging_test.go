// logging_test proves the composition root's logging decisions: format and
// level resolution with fail-closed defaults, the one-WARN report for a
// rejected value, the service identity stamped on every record, and — end to
// end over a real boot — the startup and shutdown narrative an operator
// reads in `kubectl logs`. The helpers here (quietLogger, quietProcessLogger,
// syncBuffer) are also the injection points every other suite in this
// package uses to keep tests silent by default.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// quietLogger returns the logger every test injects unless it is asserting
// log output: records go nowhere, so suites stay silent by default.
func quietLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// quietProcessLogger is the run()-shaped form of quietLogger.
func quietProcessLogger() processLogger {
	return processLogger{logger: quietLogger(), format: logFormatJSON, level: logLevelInfo}
}

// syncBuffer is a mutex-guarded byte buffer, safe to hand to a logger whose
// records arrive from run's serving goroutines while the test reads.
type syncBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *syncBuffer) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(data)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

// decodeLogLines parses one JSON record per line, failing loudly on any line
// that is not one complete object — the exact schema promise the log
// contract makes to collectors.
func decodeLogLines(t *testing.T, output string) []map[string]any {
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

// TestNewProcessLoggerResolvesFormatAndLevel pins the whole resolution
// matrix: explicit values win, empty derives the format from the terminal
// check and defaults the level to info, and the resolved names are reported
// back for the startup line.
func TestNewProcessLoggerResolvesFormatAndLevel(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		env        map[string]string
		terminal   bool
		wantFormat string
		wantLevel  string
	}{
		"defaults are JSON at info off a terminal": {terminal: false, wantFormat: logFormatJSON, wantLevel: logLevelInfo},
		"defaults are text at info on a terminal":  {terminal: true, wantFormat: logFormatText, wantLevel: logLevelInfo},
		"explicit json overrides a terminal":       {env: map[string]string{"LOG_FORMAT": "json"}, terminal: true, wantFormat: logFormatJSON, wantLevel: logLevelInfo},
		"explicit text overrides a pipe":           {env: map[string]string{"LOG_FORMAT": "text"}, terminal: false, wantFormat: logFormatText, wantLevel: logLevelInfo},
		"explicit debug level":                     {env: map[string]string{"LOG_LEVEL": "debug"}, wantFormat: logFormatJSON, wantLevel: logLevelDebug},
		"explicit warn level":                      {env: map[string]string{"LOG_LEVEL": "warn"}, wantFormat: logFormatJSON, wantLevel: logLevelWarn},
		"explicit error level":                     {env: map[string]string{"LOG_LEVEL": "error"}, wantFormat: logFormatJSON, wantLevel: logLevelError},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var out bytes.Buffer
			log := newProcessLogger(&out, testCase.terminal, fakeEnv(testCase.env))
			if log.format != testCase.wantFormat || log.level != testCase.wantLevel {
				t.Fatalf("resolved format/level = %q/%q, want %q/%q", log.format, log.level, testCase.wantFormat, testCase.wantLevel)
			}
			if out.Len() != 0 {
				t.Fatalf("recognized configuration emitted %q, want silence", out.String())
			}
			// Error is admitted at every resolvable level, so the format probe
			// works for the error-level row too.
			log.logger.Error("probe")
			line := out.String()
			isJSON := strings.HasPrefix(strings.TrimSpace(line), "{")
			if wantJSON := testCase.wantFormat == logFormatJSON; isJSON != wantJSON {
				t.Fatalf("emitted line %q does not match resolved format %q", line, log.format)
			}
		})
	}
}

// TestNewProcessLoggerFailsClosedOnUnrecognizedValues pins the fail-closed
// contract for both variables: the default is applied AND exactly one WARN
// names the rejected value — never a crash, never silent acceptance, and
// never a level or format the operator did not choose.
func TestNewProcessLoggerFailsClosedOnUnrecognizedValues(t *testing.T) {
	t.Parallel()
	for name, testCase := range map[string]struct {
		env        map[string]string
		wantFormat string
		wantLevel  string
		wantValue  string
	}{
		"unknown format falls back to the pipe default":  {env: map[string]string{"LOG_FORMAT": "xml"}, wantFormat: logFormatJSON, wantLevel: logLevelInfo, wantValue: "xml"},
		"uppercase format is rejected like other knobs":  {env: map[string]string{"LOG_FORMAT": "JSON"}, wantFormat: logFormatJSON, wantLevel: logLevelInfo, wantValue: "JSON"},
		"unknown level falls back to info":               {env: map[string]string{"LOG_LEVEL": "verbose"}, wantFormat: logFormatJSON, wantLevel: logLevelInfo, wantValue: "verbose"},
		"uppercase level is rejected":                    {env: map[string]string{"LOG_LEVEL": "DEBUG"}, wantFormat: logFormatJSON, wantLevel: logLevelInfo, wantValue: "DEBUG"},
		"hostile level value is reported without effect": {env: map[string]string{"LOG_LEVEL": "err\x1b[2Jor"}, wantFormat: logFormatJSON, wantLevel: logLevelInfo, wantValue: "err\x1b[2Jor"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var out bytes.Buffer
			log := newProcessLogger(&out, false, fakeEnv(testCase.env))
			if log.format != testCase.wantFormat || log.level != testCase.wantLevel {
				t.Fatalf("resolved format/level = %q/%q, want the %q/%q default", log.format, log.level, testCase.wantFormat, testCase.wantLevel)
			}
			records := decodeLogLines(t, out.String())
			if len(records) != 1 {
				t.Fatalf("rejection emitted %d records, want exactly one WARN: %q", len(records), out.String())
			}
			record := records[0]
			if record["level"] != "WARN" {
				t.Errorf("rejection level = %v, want WARN", record["level"])
			}
			if record["value"] != testCase.wantValue {
				t.Errorf("WARN names value %q, want the rejected %q", record["value"], testCase.wantValue)
			}
			// The hostile-value row also proves the report is injection-safe:
			// the raw escape byte must never reach the stream unencoded.
			if strings.Contains(out.String(), "\x1b") {
				t.Error("rejected value reached the log stream with a raw escape byte")
			}
		})
	}
}

// TestNewProcessLoggerHonorsTheResolvedLevel proves the level actually
// gates records — a debug record must vanish at the info default and appear
// under LOG_LEVEL=debug — so the knob is wiring, not decoration.
func TestNewProcessLoggerHonorsTheResolvedLevel(t *testing.T) {
	t.Parallel()
	var quiet bytes.Buffer
	newProcessLogger(&quiet, false, fakeEnv(nil)).logger.Debug("hidden")
	if quiet.Len() != 0 {
		t.Fatalf("info default admitted a debug record: %q", quiet.String())
	}
	var verbose bytes.Buffer
	newProcessLogger(&verbose, false, fakeEnv(map[string]string{"LOG_LEVEL": "debug"})).logger.Debug("visible")
	if !strings.Contains(verbose.String(), "visible") {
		t.Fatalf("LOG_LEVEL=debug suppressed a debug record: %q", verbose.String())
	}
}

// TestEveryRecordCarriesTheServiceIdentity pins the aggregation contract:
// whatever else a record says, it names this service.
func TestEveryRecordCarriesTheServiceIdentity(t *testing.T) {
	t.Parallel()
	var out bytes.Buffer
	log := newProcessLogger(&out, false, fakeEnv(nil))
	log.logger.Info("first")
	log.logger.Warn("second")
	records := decodeLogLines(t, out.String())
	if len(records) != 2 {
		t.Fatalf("emitted %d records, want 2", len(records))
	}
	for _, record := range records {
		if record["service.name"] != serviceName {
			t.Errorf("record %v lacks service=%q", record, serviceName)
		}
	}
}

// TestIdentityArgsNeverInventsBuildFacts pins the honesty rule for the
// identity attributes: a value the build carries is reported exactly, and a
// value it does not carry is omitted — never defaulted, never faked.
func TestIdentityArgsNeverInventsBuildFacts(t *testing.T) {
	t.Parallel()
	keysOf := func(args []any) map[string]string {
		found := map[string]string{}
		for _, arg := range args {
			attr, ok := arg.(slog.Attr)
			if !ok {
				t.Fatalf("identityArgs produced a non-Attr argument: %#v", arg)
			}
			found[attr.Key] = attr.Value.String()
		}
		return found
	}

	t.Run("no build info yields only the service name", func(t *testing.T) {
		t.Parallel()
		found := keysOf(identityArgs(nil, false))
		if len(found) != 1 || found["service.name"] != serviceName {
			t.Fatalf("identityArgs(nil, false) = %v, want only service.name=%q", found, serviceName)
		}
	})

	t.Run("devel module version is omitted, VCS facts are reported", func(t *testing.T) {
		t.Parallel()
		info := &debug.BuildInfo{}
		info.Main.Version = "(devel)"
		info.Settings = []debug.BuildSetting{
			{Key: "vcs.revision", Value: "0123456789abcdef0123456789abcdef01234567"},
			{Key: "vcs.time", Value: "2026-08-25T00:00:00Z"},
			{Key: "vcs.modified", Value: "false"},
		}
		found := keysOf(identityArgs(info, true))
		if _, ok := found["service.version"]; ok {
			t.Error("a (devel) module version must be omitted, not reported")
		}
		if found["vcs.ref.head.revision"] != "0123456789abcdef0123456789abcdef01234567" {
			t.Errorf("revision = %q, want the stamped VCS revision", found["vcs.ref.head.revision"])
		}
		if found["build_time"] != "2026-08-25T00:00:00Z" {
			t.Errorf("build_time = %q, want the stamped VCS time", found["build_time"])
		}
	})

	t.Run("a real module version is reported and absent VCS facts stay absent", func(t *testing.T) {
		t.Parallel()
		info := &debug.BuildInfo{}
		info.Main.Version = "v0.1.37"
		found := keysOf(identityArgs(info, true))
		if found["service.version"] != "v0.1.37" {
			t.Errorf("version = %q, want v0.1.37", found["service.version"])
		}
		for _, absent := range []string{"vcs.ref.head.revision", "build_time"} {
			if _, ok := found[absent]; ok {
				t.Errorf("%s reported without a VCS stamp; identity facts are never invented", absent)
			}
		}
	})
}

// TestRunNarratesTheLifecycle boots the real run() — real TCP listener, real
// drain — against a capturing JSON logger and asserts the operator-facing
// narrative: one startup line carrying the boot summary, then the shutdown
// signal and drain confirmation, in order. This is the `kubectl logs`
// experience, proven over the wire rather than assumed.
func TestRunNarratesTheLifecycle(t *testing.T) {
	t.Parallel()
	requireBuiltFrontend(t)
	out := &syncBuffer{}
	logger := slog.New(slog.NewJSONHandler(out, nil)).With(slog.String("service.name", serviceName))
	log := processLogger{logger: logger, format: logFormatJSON, level: logLevelInfo}

	ctx, cancel := context.WithCancel(t.Context())
	port := reserveLoopbackPort(t)
	environment := map[string]string{"PORT": strconv.Itoa(port), "LISTEN_ADDRESS": "127.0.0.1"}
	runResult := make(chan error, 1)
	go func() { runResult <- run(ctx, fakeEnv(environment), log) }()

	base := "http://127.0.0.1:" + strconv.Itoa(port)
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(15 * time.Second)
	for {
		response, err := client.Get(base + "/readyz")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("server did not become ready within 15s")
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	select {
	case err := <-runResult:
		if err != nil {
			t.Fatalf("run() = %v after cancellation, want a clean drain", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("run() did not drain within 15s of cancellation")
	}

	records := decodeLogLines(t, out.String())
	var startup, signal, drained map[string]any
	for _, record := range records {
		switch record["msg"] {
		case "naranjo.online listening":
			startup = record
		case "shutdown signal received":
			signal = record
		case "server drained":
			drained = record
		}
	}
	if startup == nil {
		t.Fatalf("no startup record in %q", out.String())
	}
	for key, want := range map[string]any{
		"port":           float64(port),
		"addr":           "127.0.0.1:" + strconv.Itoa(port),
		"log_format":     logFormatJSON,
		"log_level":      logLevelInfo,
		"media_enabled":  false,
		"panels_refresh": false,
		"service.name":   serviceName,
	} {
		if startup[key] != want {
			t.Errorf("startup record %s = %v, want %v", key, startup[key], want)
		}
	}
	if signal == nil || drained == nil {
		t.Fatalf("shutdown narrative incomplete (signal=%v drained=%v) in %q", signal != nil, drained != nil, out.String())
	}
}
