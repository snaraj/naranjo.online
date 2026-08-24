# Local-development convenience targets only. This is NOT the CI/PR quality
# gate — that battery is canonical in AGENTS.md ("Quality gates — exact
# commands and patterns") and stays there so it can never drift from what CI
# actually enforces; `make help` only points at it.

.PHONY: help deps build run dev

.DEFAULT_GOAL := help

# Overridable: `make run PORT=9090` or `make dev PORT=9090`.
PORT ?= 8080

FRONTEND := frontend
# Gitignored; never committed. Rebuilt on every `make dev`.
DEV_BINARY := .dev-server
DEPS_STAMP := $(FRONTEND)/node_modules/.deps-stamp

help: ## Show this help
	@echo "naranjo.online — local development"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  make %-6s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "PORT overrides the backend port for run/dev (default 8080)."
	@echo "The full quality-gate battery is NOT here — see AGENTS.md \"Quality gates\"."

# Reruns npm ci only when package-lock.json is newer than the last install.
$(DEPS_STAMP): $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm ci
	@touch $@

deps: $(DEPS_STAMP) ## Install frontend dependencies (skips when already current)

build: deps ## Build the frontend into internal/web/dist (the Go embed tree)
	cd $(FRONTEND) && npm run build

run: build ## Run the full app at http://localhost:$(PORT) (Ctrl-C to stop)
	PORT=$(PORT) go run ./cmd/server

# The backend is a REAL BUILT BINARY launched by captured PID, never a
# backgrounded `go run` — `go run`'s child process survives the parent's
# death and orphans the listening port (the standing :8080 incident;
# live-validation skill §isolation). The trap kills that exact PID on
# EXIT/INT/TERM, so Ctrl-C out of the foreground `npm run dev` always frees
# the port behind it.
dev: build ## Live-edit loop: built backend in the background, Vite HMR in the foreground
	go build -o $(DEV_BINARY) ./cmd/server
	PORT=$(PORT) ./$(DEV_BINARY) & \
	backend_pid=$$!; \
	trap 'kill $$backend_pid 2>/dev/null; wait $$backend_pid 2>/dev/null' EXIT INT TERM; \
	cd $(FRONTEND) && DEV_API_PORT=$(PORT) npm run dev
