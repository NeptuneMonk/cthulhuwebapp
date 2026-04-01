# Cthulhu Backend — Test Runner
# Usage:
#   make test          — run all regression tests
#   make test-quick    — run generic (non-iteration) regression tests only
#   make test-single T=test_api.py  — run a single test file

API_URL ?= $(shell grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)

# Generic regression tests (stable, non-iteration-specific)
GENERIC_TESTS = \
	tests/test_api.py \
	tests/test_cross_lang.py \
	tests/test_ipfs.py \
	tests/test_mesh_endpoints.py \
	tests/test_object_counts_fix.py \
	tests/test_onchain_text_and_storefront.py \
	tests/test_onchain_text_objects.py \
	tests/test_p2fk_compat.py \
	tests/test_p2fk_sig_format.py \
	tests/test_p2fk_wallet.py \
	tests/test_paywall.py \
	tests/test_searchstring_api.py \
	tests/test_sig_verify.py \
	tests/test_supflix.py \
	tests/test_urn_check.py \
	tests/test_wallet.py

# All active tests (generic + recent iteration-specific)
ALL_TESTS = $(GENERIC_TESTS) $(wildcard tests/test_*_iter1[7-9]*.py tests/test_*_iter19*.py)

.PHONY: test test-quick test-single health

health:
	@curl -s -o /dev/null -w "Backend health: HTTP %{http_code}\n" $(API_URL)/api/health

test: health
	@echo "Running ALL $(words $(ALL_TESTS)) active regression tests..."
	@passed=0; failed=0; errors=""; \
	for t in $(ALL_TESTS); do \
		printf "  %-60s" "$$t"; \
		output=$$(cd /app/backend && python -m pytest $$t -x -q --tb=short 2>&1); \
		if [ $$? -eq 0 ]; then \
			echo "PASS"; \
			passed=$$((passed + 1)); \
		else \
			echo "FAIL"; \
			failed=$$((failed + 1)); \
			errors="$$errors\n--- $$t ---\n$$output\n"; \
		fi; \
	done; \
	echo ""; \
	echo "Results: $$passed passed, $$failed failed / $(words $(ALL_TESTS)) total"; \
	if [ $$failed -gt 0 ]; then \
		echo ""; \
		echo "=== FAILURES ==="; \
		printf "$$errors"; \
		exit 1; \
	fi

test-quick: health
	@echo "Running $(words $(GENERIC_TESTS)) generic regression tests..."
	@cd /app/backend && python -m pytest $(GENERIC_TESTS) -v --tb=short 2>&1

test-single: health
	@echo "Running single test: tests/$(T)"
	@cd /app/backend && python -m pytest tests/$(T) -v --tb=short 2>&1
