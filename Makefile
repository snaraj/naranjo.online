# Local-development convenience targets only. This is NOT the CI/PR quality
# gate — that battery is canonical in AGENTS.md ("Quality gates — exact
# commands and patterns") and stays there so it can never drift from what CI
# actually enforces; `make help` only points at it.

.PHONY: help deps build validate-port run dev

.DEFAULT_GOAL := help

# Overridable: `make run PORT=9090` or `make dev PORT=9090`. `export`
# (rather than Make's own $(PORT) textual substitution inside a recipe body)
# is deliberate: it puts PORT in the recipe shell's ENVIRONMENT, so every
# recipe below reads it via a quoted shell expansion ($$PORT) instead of
# having Make paste the raw string into the command line as text. An
# untrusted value pasted as text is a shell-injection vector — see
# validate-port below and its regression cases in
# scripts/ci/makefile-invariants.sh — and, one layer further in, an
# unvalidated port concatenated into a URL string can move a proxy target
# off its intended host entirely (see frontend/vite.config.ts's own
# independent validation of DEV_API_PORT).
PORT ?= 8080
export PORT

FRONTEND := frontend
# Gitignored; never committed. Rebuilt on every `make dev`.
DEV_BINARY := .dev-server
DEPS_STAMP := $(FRONTEND)/node_modules/.deps-stamp

help: ## Show this help
	@echo "naranjo.online — local development"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  make %-6s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "PORT overrides the backend port for run/dev (default 8080);"
	@echo "must be a decimal integer 1-65535, checked before anything starts."
	@echo "The full quality-gate battery is NOT here — see AGENTS.md \"Quality gates\"."

# Reruns npm ci only when package-lock.json is newer than the last install.
# The canonical flags match AGENTS.md "Quality gates" exactly: --ignore-scripts
# refuses postinstall/preinstall execution from the lockfile's own
# hasInstallScript dependencies, --no-audit and --no-fund skip network calls
# this local loop has no business making.
$(DEPS_STAMP): $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm ci --ignore-scripts --no-audit --no-fund
	@touch $@

deps: $(DEPS_STAMP) ## Install frontend dependencies (skips when already current)

build: deps ## Build the frontend into internal/web/dist (the Go embed tree)
	cd $(FRONTEND) && npm run build

# Fails closed on any PORT that is not a plain decimal integer in 1-65535 --
# BEFORE run/dev ever hand PORT to a shell command, a URL, or a child
# process. This is the ONLY point that inspects the raw, possibly-hostile
# PORT value from the command line; every recipe below only ever sees it
# again through the environment, after this gate has already passed. The
# case pattern matches on the shell's own quoted expansion ("$$PORT"), never
# on Make-substituted text, so even a value containing quotes, semicolons,
# backticks, or "$(...)" cannot be interpreted as anything but inert data
# here — see scripts/ci/makefile-invariants.sh for the hostile regression
# cases this closes.
validate-port:
	@case "$$PORT" in \
		''|*[!0-9]*) \
			echo "ERROR: PORT must be a decimal integer 1-65535 (got '$$PORT')" >&2; \
			exit 1 ;; \
	esac; \
	if [ "$$PORT" -lt 1 ] || [ "$$PORT" -gt 65535 ]; then \
		echo "ERROR: PORT must be a decimal integer 1-65535 (got '$$PORT')" >&2; \
		exit 1; \
	fi

run: validate-port build ## Run the full app at http://localhost:$(PORT) (Ctrl-C to stop)
	LISTEN_ADDRESS=127.0.0.1 go run ./cmd/server

# The backend is a REAL BUILT BINARY launched by captured PID, never a
# backgrounded `go run` — `go run`'s child process survives the parent's
# death and orphans the listening port (the standing :8080 incident;
# live-validation skill §isolation). The trap kills that exact PID on
# EXIT/INT/TERM, so Ctrl-C out of the foreground `npm run dev` always frees
# the port behind it. LISTEN_ADDRESS=127.0.0.1 (both here and in `run` above)
# is this dev loop's own opt-in: cmd/server's default, unset behavior — the
# one the deployed Helm chart actually uses — is untouched.
dev: validate-port build ## Live-edit loop: built backend in the background, Vite HMR in the foreground
	go build -o $(DEV_BINARY) ./cmd/server
	LISTEN_ADDRESS=127.0.0.1 ./$(DEV_BINARY) & \
	backend_pid=$$!; \
	trap 'kill $$backend_pid 2>/dev/null; wait $$backend_pid 2>/dev/null' EXIT INT TERM; \
	cd $(FRONTEND) && DEV_API_PORT="$$PORT" npm run dev
