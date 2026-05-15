.PHONY: start dev api stop migrate

PORT_API ?= 7273
PORT_DEV ?= 7272

start: migrate
	@echo "Killing existing processes on :$(PORT_API) and :$(PORT_DEV)..."
	@for port in $(PORT_API) $(PORT_DEV); do pid=$$(lsof -ti :$$port 2>/dev/null) && kill -9 $$pid 2>/dev/null; done || true
	@sleep 1
	@echo "Starting API on :$(PORT_API) and frontend on :$(PORT_DEV)..."
	@npx concurrently --kill-others --names api,web --prefix-colors cyan,green \
		"npm run dev:api" "npm run dev"

dev:
	npm run dev

api:
	npm run dev:api

stop:
	@kill $$(lsof -ti :$(PORT_API)) $$(lsof -ti :$(PORT_DEV)) 2>/dev/null && echo "Stopped." || echo "No processes found."

migrate:
	npm run db:migrate
