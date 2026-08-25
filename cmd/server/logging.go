// logging.go builds the one process logger the composition root owns. The
// design is injection-first: main constructs the logger exactly once from the
// environment, installs it as the slog default, and hands it to run, which
// passes it to every component that logs. No other file constructs a handler,
// so tests inject quiet or capturing loggers and the process stays silent or
// observable on the caller's terms.
//
// Format and level are operator configuration, not security behavior: an
// unrecognized value can neither disable a control nor widen a surface, so —
// unlike PANELS_REFRESH or MEDIA_ENABLED, whose bad values refuse the boot —
// a bad LOG_FORMAT or LOG_LEVEL fails closed to the default and says so with
// one WARN naming the rejected value. A pod with a typo in its logging config
// keeps serving, loudly, instead of crash-looping over cosmetics.

package main

import (
	"io"
	"log/slog"
	"os"
	"runtime/debug"
)

// newProcessLogger resolves LOG_FORMAT and LOG_LEVEL through lookupEnv,
// builds the handler over out, and stamps the service identity attributes on
// every record. terminal selects the human default: text on an interactive
// stdout, JSON everywhere else — which is what makes `kubectl logs` show
// structured JSON with zero configuration while `make run` stays readable.
func newProcessLogger(out io.Writer, terminal bool, lookupEnv func(string) string) processLogger {
	rawFormat := lookupEnv("LOG_FORMAT")
	rawLevel := lookupEnv("LOG_LEVEL")
	format, formatKnown := resolveLogFormat(rawFormat, terminal)
	level, levelName, levelKnown := resolveLogLevel(rawLevel)

	options := &slog.HandlerOptions{Level: level}
	var handler slog.Handler
	if format == logFormatText {
		handler = slog.NewTextHandler(out, options)
	} else {
		handler = slog.NewJSONHandler(out, options)
	}
	logger := slog.New(handler).With(identityArgs(debug.ReadBuildInfo())...)

	// The rejections are reported through the logger they configured — after
	// construction, so the report itself is well-formed — at WARN, which the
	// defaulted "info" level always admits.
	if !formatKnown {
		logger.Warn("unrecognized LOG_FORMAT value; using the default",
			"value", rawFormat, "default", format)
	}
	if !levelKnown {
		logger.Warn("unrecognized LOG_LEVEL value; using the default",
			"value", rawLevel, "default", levelName)
	}
	return processLogger{logger: logger, format: format, level: levelName}
}

// resolveLogFormat admits exactly "json" and "text" (lowercase, mirroring
// the strictness of every other environment switch in this file's package).
// Empty selects the terminal-derived default; anything else reports
// unrecognized and fails closed to that same default.
func resolveLogFormat(value string, terminal bool) (string, bool) {
	fallback := logFormatJSON
	if terminal {
		fallback = logFormatText
	}
	switch value {
	case "":
		return fallback, true
	case logFormatJSON, logFormatText:
		return value, true
	}
	return fallback, false
}

// resolveLogLevel admits exactly debug, info, warn, and error (lowercase).
// Empty selects the "info" default; anything else reports unrecognized and
// fails closed to it.
func resolveLogLevel(value string) (slog.Level, string, bool) {
	switch value {
	case "":
		return slog.LevelInfo, logLevelInfo, true
	case logLevelDebug:
		return slog.LevelDebug, logLevelDebug, true
	case logLevelInfo:
		return slog.LevelInfo, logLevelInfo, true
	case logLevelWarn:
		return slog.LevelWarn, logLevelWarn, true
	case logLevelError:
		return slog.LevelError, logLevelError, true
	}
	return slog.LevelInfo, logLevelInfo, false
}

// identityArgs derives the service identity stamped on every log record:
// the fixed service name, plus the module version and VCS revision/time when
// the build actually carries them. Nothing is ever invented — a build
// without VCS stamping (the container build excludes .git) simply omits the
// attributes rather than faking a value, per the honest-states doctrine.
//
// Attribute names follow OpenTelemetry semantic conventions (service.name,
// service.version, vcs.ref.head.revision), so an OTel Collector ingesting
// this pod's stdout maps the resource identity with zero remapping;
// build_time is a documented custom attribute (no stable convention names
// a build timestamp). See README "Observability contract".
func identityArgs(info *debug.BuildInfo, ok bool) []any {
	args := []any{slog.String("service.name", serviceName)}
	if !ok || info == nil {
		return args
	}
	if version := info.Main.Version; version != "" && version != "(devel)" {
		args = append(args, slog.String("service.version", version))
	}
	for _, setting := range info.Settings {
		if setting.Value == "" {
			continue
		}
		switch setting.Key {
		case "vcs.revision":
			args = append(args, slog.String("vcs.ref.head.revision", setting.Value))
		case "vcs.time":
			args = append(args, slog.String("build_time", setting.Value))
		}
	}
	return args
}

// isTerminal reports whether f is an interactive terminal (a character
// device). It decides only the log-format default and is overridable either
// way with LOG_FORMAT, so a wrong answer costs a formatting default, never
// behavior.
func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}
