import pytest
from fastapi import HTTPException

from api.limits import AnalystLimits


def test_busy_requests_do_not_consume_quota_and_release_is_idempotent():
    guard = AnalystLimits(per_ip=1)
    release = guard.admit('one')
    with pytest.raises(HTTPException) as blocked:
        guard.admit('two')
    assert blocked.value.status_code == 429
    assert blocked.value.headers['Retry-After'] == '15'
    release()
    release()
    assert guard.active == 0
    guard.admit('two')()


def test_per_ip_window_expires_but_daily_limit_survives_ip_changes():
    now = [0.0]
    guard = AnalystLimits(per_ip=1, window=60, daily=2, clock=lambda: now[0])
    guard.admit('one')()
    with pytest.raises(HTTPException):
        guard.admit('one')
    now[0] = 61
    guard.admit('one')()
    with pytest.raises(HTTPException) as blocked:
        guard.admit('different-ip')
    assert 'daily' in blocked.value.detail
    now[0] = 86462
    guard.admit('one')()


def test_invalid_limits_cannot_disable_protection_accidentally():
    with pytest.raises(ValueError):
        AnalystLimits(daily=0)


def test_api_rejects_invalid_or_oversized_questions_without_ai_calls(monkeypatch):
    from fastapi.testclient import TestClient
    from api.main import app
    with TestClient(app) as client:
        assert client.post('/api/analyst/ask', json={'ws': 'spotify', 'question': ' '}).status_code == 422
        assert client.post('/api/analyst/ask', json={'ws': 'invalid', 'question': 'hello'}).status_code == 422
        assert client.post('/api/analyst/ask', json={'ws': 'spotify', 'question': 'q' * 801}).status_code == 422
        assert client.post('/api/analyst/ask', json={'ws': 'spotify', 'question': 'q' * 5000}).status_code == 413
        monkeypatch.delenv('GROQ_API_KEY', raising=False)
        assert client.post('/api/analyst/ask', json={'ws': 'spotify', 'question': 'hello'}).status_code == 503


def test_cors_allows_the_frontend_and_rejects_other_websites():
    from fastapi.testclient import TestClient
    from api.main import app
    with TestClient(app) as client:
        headers = {'Origin': 'https://simran-kalkeri.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type'}
        assert client.options('/api/analyst/ask', headers=headers).status_code == 200
        headers['Origin'] = 'https://unrelated.example'
        assert client.options('/api/analyst/ask', headers=headers).status_code == 400


def test_live_call_budget_caps_requests_even_across_model_fallbacks():
    import time
    from analyst.llm import CallBudget
    budget = CallBudget(deadline=time.monotonic() + 60, remaining_calls=2)
    assert budget.take() <= 20
    assert budget.take() <= 20
    with pytest.raises(RuntimeError, match='request budget'):
        budget.take()
    with pytest.raises(TimeoutError):
        CallBudget(deadline=time.monotonic() - 1).take()
