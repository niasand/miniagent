.PHONY: start dev api stop migrate

PORT_API ?= 7273
PORT_DEV ?= 7272

start: migrate
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
