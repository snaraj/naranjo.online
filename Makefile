# Local-development convenience targets only. This is NOT the CI/PR quality
# gate — that battery is canonical in AGENTS.md ("Quality gates — exact
# commands and patterns") and stays there so it can never drift from what CI
# actually enforces; `make help` only points at it.

.PHONY: help deps build validate-port run dev

.DEFAULT_GOAL := help

# PORT is read STRICTLY from the process environment: `PORT=9090 make run`.
# It is deliberately NEVER a Make command-line override (`make run
# PORT=9090` is UNSUPPORTED) and this file declares NO Make variable named
# PORT at all -- no `PORT ?=`, no `export`, nothing Make's own variable
# engine ever stores or touches.
#
# This is not a style choice. Round 2 of this fix used `export PORT` plus
# `$(value PORT)` to capture the raw text before Make's own textual
# substitution could run it through a shell -- and that closed the shell-
# metacharacter vector. But GNU Make ALSO reconstructs MAKEOVERRIDES/MFLAGS
# from every command-line `VAR=value` argument, for every target, to
# propagate overrides to a recursive $(MAKE) sub-invocation this Makefile
# doesn't even have -- and building that reconstruction FULLY EXPANDS each
# override's raw text, including any embedded $(shell ...) call, before a
# single recipe line runs. Verified empirically (scratch Makefiles, not
# reproduced here): `make anytarget PORT='$(shell touch marker)'` created
# `marker` every time, and NONE of the following defended against it --
#   - capturing via `RAW_PORT := $(value PORT)` before export: still ran
#     (the override reconstruction expands PORT independently of what our
#     own variable does with it);
#   - never exporting PORT at all: still ran, even against a Makefile that
#     does not mention PORT anywhere;
#   - blanking `MAKEOVERRIDES :=` at the top of the file: still ran.
# The expansion happens inside Make's own command-line-argument handling,
# before the Makefile is fully read, so no Makefile-side code can intercept
# it. An environment-set PORT never goes through this reconstruction at
# all (verified the same way, same hostile payload: no marker) because
# child processes already inherit the environment through the OS, not
# through Make's override-propagation machinery -- so it is the only
# interface this Makefile supports.
#
# scripts/ci/makefile-invariants.sh exercises the supported interface with
# this exact hostile shape (and the shell-metacharacter and "@"-host shapes
# from round 1) against validate-port, run, dev, and an unrelated target.

FRONTEND := frontend
# Gitignored; never committed. Rebuilt on every `make dev`.
DEV_BINARY := .dev-server
DEPS_STAMP := $(FRONTEND)/node_modules/.deps-stamp

help: ## Show this help
	@echo "naranjo.online — local development"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  make %-6s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "PORT overrides the backend port for run/dev (default 8080) --"
	@echo "set it as an environment variable: PORT=9090 make run. It must be"
	@echo "a decimal integer 1-65535, checked before anything starts. Do NOT"
	@echo "pass PORT=... as a make argument (make run PORT=9090); GNU Make"
	@echo "expands command-line overrides through its own MAKEOVERRIDES"
	@echo "machinery before any recipe runs, which this repository's own"
	@echo "review found unsafe for untrusted input."
	@echo "The full quality-gate battery is NOT here — see AGENTS.md \"Quality gates\"."

# Reruns npm ci only when package-lock.json is newer than the last install.
# The canonical flags match AGENTS.md "Quality gates" exactly: --ignore-scripts
# refuses postinstall/preinstall execution from the lockfile's own
# hasInstallScript dependencies, --no-audit and --no-fund skip network calls
# this local loop has no business making. Pinned by
# scripts/ci/makefile-invariants.sh, wired into pr-gate.yml's application job.
$(DEPS_STAMP): $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm ci --ignore-scripts --no-audit --no-fund
	@touch $@

deps: $(DEPS_STAMP) ## Install frontend dependencies (skips when already current)

build: deps ## Build the frontend into internal/web/dist (the Go embed tree)
	cd $(FRONTEND) && npm run build

# Fails closed on any PORT that is not a plain decimal integer in 1-65535 --
# BEFORE run/dev ever hand it to a shell command, a URL, or a child process.
# Reads ONLY the process environment ("$${PORT:-8080}", pure shell parameter
# expansion, defaulting exactly like cmd/server's own listenPort does for an
# empty PORT) -- never a Make variable, so there is nothing here for
# MAKEOVERRIDES to expand. The case pattern matches on the shell's own
# quoted expansion, never on Make-substituted text, so even a value
# containing quotes, semicolons, backticks, or "$(...)" cannot be
# interpreted as anything but inert data here.
validate-port:
	@port="$${PORT:-8080}"; \
	case "$$port" in \
		''|*[!0-9]*) \
			echo "ERROR: PORT must be a decimal integer 1-65535 (got '$$port')" >&2; \
			exit 1 ;; \
	esac; \
	if [ "$$port" -lt 1 ] || [ "$$port" -gt 65535 ]; then \
		echo "ERROR: PORT must be a decimal integer 1-65535 (got '$$port')" >&2; \
		exit 1; \
	fi

run: validate-port build ## Run the full app at http://localhost:$$PORT (Ctrl-C to stop; PORT=9090 make run to override)
	PORT="$${PORT:-8080}" LISTEN_ADDRESS=127.0.0.1 go run ./cmd/server

# The backend is a REAL BUILT BINARY launched by captured PID, never a
# backgrounded `go run` — `go run`'s child process survives the parent's
# death and orphans the listening port (the standing :8080 incident;
# live-validation skill §isolation). The trap kills that exact PID on
# EXIT/INT/TERM, so Ctrl-C out of the foreground `npm run dev` always frees
# the port behind it. LISTEN_ADDRESS=127.0.0.1 (both here and in `run` above)
# is this dev loop's own opt-in: cmd/server's default, unset behavior — the
# one the deployed Helm chart actually uses — is untouched.
dev: validate-port build ## Live-edit loop: built backend in the background, Vite HMR in the foreground (PORT=9090 make dev to override)
	go build -o $(DEV_BINARY) ./cmd/server
	effective_port="$${PORT:-8080}"; \
	PORT="$$effective_port" LISTEN_ADDRESS=127.0.0.1 ./$(DEV_BINARY) & \
	backend_pid=$$!; \
	trap 'kill $$backend_pid 2>/dev/null; wait $$backend_pid 2>/dev/null' EXIT INT TERM; \
	cd $(FRONTEND) && DEV_API_PORT="$$effective_port" npm run dev
