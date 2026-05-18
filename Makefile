# ══════════════════════════════════════════════════════════════════════════════
#  BAML Risk Intelligence Platform — Developer Makefile
#
#  Prerequisites: Docker, Docker Compose v2
#
#  Usage:
#    make up           Start all services (dev mode with hot-reload)
#    make down         Stop and remove containers
#    make build        Rebuild all images
#    make logs         Tail logs from all services
#    make migrate      Run Alembic migrations inside the backend container
#    make test         Run backend test suite
#    make shell        Open a shell in the backend container
#    make psql         Open psql in the database container
# ══════════════════════════════════════════════════════════════════════════════

COMPOSE       := docker compose
COMPOSE_PROD  := docker compose -f docker-compose.yml
ENV_FILE      := .env.local

# ── Lifecycle ──────────────────────────────────────────────────────────────────

.PHONY: up
up: env-check
	$(COMPOSE) up

.PHONY: up-detached
up-detached: env-check
	$(COMPOSE) up -d

.PHONY: down
down:
	$(COMPOSE) down

.PHONY: down-volumes
down-volumes:
	$(COMPOSE) down -v

.PHONY: build
build:
	$(COMPOSE) build --no-cache

.PHONY: rebuild
rebuild:
	$(COMPOSE) build

.PHONY: restart-backend
restart-backend:
	$(COMPOSE) restart backend

.PHONY: restart-frontend
restart-frontend:
	$(COMPOSE) restart frontend

# ── Production-like local run (no source mounts, no hot-reload) ────────────────

.PHONY: up-prod
up-prod: env-check
	$(COMPOSE_PROD) up --build

# ── Logs ──────────────────────────────────────────────────────────────────────

.PHONY: logs
logs:
	$(COMPOSE) logs -f

.PHONY: logs-backend
logs-backend:
	$(COMPOSE) logs -f backend

.PHONY: logs-frontend
logs-frontend:
	$(COMPOSE) logs -f frontend

.PHONY: logs-db
logs-db:
	$(COMPOSE) logs -f db

# ── Database ──────────────────────────────────────────────────────────────────

.PHONY: migrate
migrate:
	$(COMPOSE) exec backend alembic upgrade head

.PHONY: migrate-down
migrate-down:
	$(COMPOSE) exec backend alembic downgrade -1

.PHONY: migrate-history
migrate-history:
	$(COMPOSE) exec backend alembic history --verbose

.PHONY: migration
## make migration MSG="add_scenario_tags"
migration:
	$(COMPOSE) exec backend alembic revision --autogenerate -m "$(MSG)"

.PHONY: psql
psql:
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-baml_user} -d $${POSTGRES_DB:-baml_risk_db}

# ── Application shells ─────────────────────────────────────────────────────────

.PHONY: shell
shell:
	$(COMPOSE) exec backend sh

.PHONY: shell-frontend
shell-frontend:
	$(COMPOSE) exec frontend sh

# ── Testing ───────────────────────────────────────────────────────────────────

.PHONY: test
test:
	$(COMPOSE) exec backend pytest tests/ -v

.PHONY: test-fast
test-fast:
	$(COMPOSE) exec backend pytest tests/ -v -x --tb=short

# ── Setup helpers ──────────────────────────────────────────────────────────────

.PHONY: env-check
env-check:
	@if [ ! -f "$(ENV_FILE)" ]; then \
	    echo ""; \
	    echo "  ERROR: $(ENV_FILE) not found."; \
	    echo "  Run:  cp .env.docker .env.local"; \
	    echo "  Then edit .env.local and set a real SECRET_KEY."; \
	    echo ""; \
	    exit 1; \
	fi

.PHONY: env-init
env-init:
	@if [ -f "$(ENV_FILE)" ]; then \
	    echo "$(ENV_FILE) already exists — skipping."; \
	else \
	    cp .env.docker $(ENV_FILE); \
	    echo "Created $(ENV_FILE) from .env.docker"; \
	    echo "Edit it and set a real SECRET_KEY before running make up."; \
	fi

.PHONY: help
help:
	@echo ""
	@echo "BAML Risk Intelligence Platform — make targets"
	@echo "────────────────────────────────────────────────"
	@echo "  make env-init         Copy .env.docker → .env.local (first-time setup)"
	@echo "  make up               Start all services with hot-reload"
	@echo "  make up-detached      Start all services in background"
	@echo "  make down             Stop all containers"
	@echo "  make down-volumes     Stop containers and delete volumes (data loss!)"
	@echo "  make build            Rebuild all images from scratch"
	@echo "  make logs             Tail all service logs"
	@echo "  make logs-backend     Tail backend logs only"
	@echo "  make migrate          Apply pending Alembic migrations"
	@echo "  make migration MSG=x  Generate a new migration revision"
	@echo "  make psql             Open psql in the database container"
	@echo "  make shell            Open a shell in the backend container"
	@echo "  make test             Run backend test suite"
	@echo "  make up-prod          Production-like run (no source mounts)"
	@echo ""
