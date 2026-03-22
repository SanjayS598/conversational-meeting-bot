.PHONY: setup redis dev mock smoke ui clean

# ── Setup ─────────────────────────────────────────────────────────────────────

setup:
	@echo "Creating virtual environment..."
	python3 -m venv .venv
	@echo "Installing dependencies..."
	.venv/bin/pip install --upgrade pip -q
	.venv/bin/pip install -r requirements.txt -q
	@echo ""
	@echo "Done! Activate with:  source .venv/bin/activate"

# ── Infrastructure ────────────────────────────────────────────────────────────

redis:
	@echo "Starting Redis via Docker..."
	docker run -d --name gemini-redis -p 6379:6379 redis:7-alpine || docker start gemini-redis
	@echo "Redis running on port 6379"

redis-stop:
	docker stop gemini-redis

# ── Services ──────────────────────────────────────────────────────────────────

dev:
	@echo "Starting Gemini Intelligence Service on port 3002..."
	.venv/bin/python -m uvicorn src.main:app --host 0.0.0.0 --port 3002 --reload --log-level info

mock:
	@echo "Starting mock Control Backend (4000) and Voice Runtime (5000)..."
	.venv/bin/python tests/mock_services.py

# ── Testing ───────────────────────────────────────────────────────────────────

smoke:
	@echo "Running smoke test..."
	.venv/bin/python tests/smoke_test.py

ui:
	@echo "Serving test UI at http://localhost:8080/tests/ui_test.html ..."
	.venv/bin/python -m http.server 8080

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean:
	rm -rf .venv __pycache__ src/**/__pycache__ .pytest_cache
