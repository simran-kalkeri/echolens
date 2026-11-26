"""API responses match the shapes in docs/api-contract.ts (key-level check on real data)."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not (ROOT / "data" / "lake" / "gold").exists(), reason="gold tables not built")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


FEEDBACK_KEYS = {"id", "ws", "source", "text", "created_at", "rating", "sentiment", "sentiment_score", "intent", "urgency", "aspects", "theme_id", "theme_name"}


def test_workspaces(client):
    ws = client.get("/api/workspaces").json()
    assert {w["id"] for w in ws} >= {"spotify", "apple", "amazon", "uber", "delta", "xbox"}
    assert set(ws[0]) == {"id", "name", "sources", "n_feedback", "date_min", "date_max"}


def test_overview(client):
    o = client.get("/api/overview", params={"ws": "spotify"}).json()
    assert set(o) == {"kpis", "sentiment_trend", "theme_stream", "channel_mix", "intent_mix", "urgency_mix", "aspect_sentiment", "top_movers", "calendar"}
    assert o["kpis"]["total"] > 0


def test_themes_and_detail(client):
    t = client.get("/api/themes", params={"ws": "spotify"}).json()
    theme = t["aspects"][0]["themes"][0]
    d = client.get(f"/api/themes/{theme['id']}", params={"ws": "spotify"}).json()
    assert {"intent_mix", "urgency_mix", "related", "evidence", "summary"} <= set(d)
    assert set(d["evidence"][0]) == FEEDBACK_KEYS


def test_feedback_filters_and_search(client):
    p = client.get("/api/feedback", params={"ws": "spotify", "sentiment": "negative", "page_size": 5}).json()
    assert p["total"] > 0 and all(i["sentiment"] == "negative" for i in p["items"])
    s = client.get("/api/feedback", params={"ws": "spotify", "q": "shuffle keeps playing the same songs", "page_size": 5}).json()
    assert len(s["items"]) == 5


def test_alerts_graph_galaxy(client):
    for path in ["/api/alerts", "/api/graph", "/api/galaxy"]:
        assert client.get(path, params={"ws": "spotify"}).status_code == 200
