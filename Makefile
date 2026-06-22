.PHONY: dev backend frontend test build docker

dev:
	docker compose up --build

backend:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd frontend && npm run dev -- --host 0.0.0.0

test:
	cd backend && pytest

build:
	cd frontend && npm run build

docker:
	docker compose up --build
