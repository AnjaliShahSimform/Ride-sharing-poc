.PHONY: help install dev dev-web down migrate seed studio test test-web build

help:
	@echo "make install    - install backend + frontend dependencies"
	@echo "make dev        - start Postgres, then the backend dev server (localhost:3000)"
	@echo "make dev-web    - start the frontend dev server (localhost:5173)"
	@echo "make down       - stop Postgres"
	@echo "make migrate    - apply pending Prisma migrations"
	@echo "make seed       - seed the database with sample drivers/riders/rides"
	@echo "make studio     - open Prisma Studio (DB browser) on localhost:5555"
	@echo "make test       - run the backend test suite"
	@echo "make test-web   - run the frontend test suite"
	@echo "make build      - build the backend for production"

install:
	npm install
	cd web && npm install

dev:
	docker compose up -d db
	npm run dev

dev-web:
	cd web && npm run dev

down:
	docker compose down

migrate:
	npm run prisma:migrate

seed:
	npm run db:seed

studio:
	npx prisma studio

test:
	npm test

test-web:
	cd web && npm test

build:
	npm run build
