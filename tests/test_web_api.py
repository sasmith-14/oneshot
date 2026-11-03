"""Endpoints added for the web console: liveness, the provider record, and the /ui mount."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from fakeprovider.process import ProviderProcess, free_port
from oneshot.api import create_app
from oneshot.store import ActionStore
from oneshot.worker import Worker
from oneshot.provider_client import ProviderClient
from tests.conftest import CHARGE


@pytest.fixture
def offline(settings):
    """Settings pointing at a port where nothing listens (never at a dev stack on :8701)."""
    return settings.with_overrides(provider_url=f"http://127.0.0.1:{free_port()}")


def submit(api, key="k1"):
    resp = api.post("/actions", json={"type": "payment.charge", "payload": CHARGE}, headers={"Idempotency-Key": key})
    assert resp.status_code == 201
    return resp.json()["id"]


# ------------------------------------------------------------------ heartbeats


def test_heartbeat_upserts_and_clean_stop_is_recorded(store, clock):
    store.heartbeat("w1", 111)
    clock.advance(5)
    store.heartbeat("w1", 111)
    [w] = store.workers()
    assert (w["started_at"], w["last_seen_at"], w["stopped_at"]) == (1_000_000.0, 1_000_005.0, None)
    store.worker_stopped("w1")
    assert store.workers()[0]["stopped_at"] == 1_000_005.0


def test_worker_run_beats_and_marks_itself_stopped(offline):
    store = ActionStore(offline.db_path)
    client = ProviderClient(offline)
    Worker(store, client, offline, worker_id="w-run", log=lambda m: None).run(drain=True)
    client.close()
    [w] = store.workers()
    assert w["id"] == "w-run" and w["stopped_at"] is not None


# --------------------------------------------------------------- system status


def test_status_reports_unreachable_provider_and_worker_states(offline, tmp_path):
    api = TestClient(create_app(offline, lab=False, web_dist=tmp_path))
    store = ActionStore(offline.db_path)
    store.heartbeat("alive", 1)
    store.heartbeat("gone", 2)
    store.worker_stopped("gone")
    submit(api)

    body = api.get("/system/status").json()
    assert body["provider"]["reachable"] is False and body["provider"]["error"]
    assert body["lab"] is False
    assert body["counts"] == {"PENDING": 1}
    states = {w["id"]: w["state"] for w in body["workers"]}
    assert states == {"alive": "alive", "gone": "stopped"}
    assert body["settings"]["provider_settle_seconds"] == offline.provider_settle_seconds


def test_status_marks_a_worker_silent_when_heartbeats_stop(offline, tmp_path):
    """A SIGKILLed worker never writes stopped_at; it just goes quiet."""
    old = ActionStore(offline.db_path, clock=lambda: 0.0)  # heartbeat written "long ago"
    old.heartbeat("killed", 3)
    body = TestClient(create_app(offline, lab=False, web_dist=tmp_path)).get("/system/status").json()
    assert body["workers"][0]["state"] == "silent"


def test_provider_record_is_503_when_provider_is_down_and_404_for_unknown_action(offline, tmp_path):
    api = TestClient(create_app(offline, lab=False, web_dist=tmp_path))
    action_id = submit(api)
    assert api.get(f"/actions/{action_id}/provider-record").status_code == 503
    assert api.get("/actions/act_nope/provider-record").status_code == 404


@pytest.mark.integration
def test_provider_record_returns_the_providers_own_effects(settings, tmp_path):
    with ProviderProcess(tmp_path / "p.db") as provider:
        cfg = settings.with_overrides(provider_url=provider.url)
        api = TestClient(create_app(cfg, lab=False, web_dist=tmp_path))
        action_id = submit(api)
        assert api.get(f"/actions/{action_id}/provider-record").json()["effects"] == []
        assert api.get("/system/status").json()["provider"]["reachable"] is True

        store, client = ActionStore(cfg.db_path), ProviderClient(cfg)
        Worker(store, client, cfg, worker_id="w", log=lambda m: None).run(drain=True)
        client.close()

        [effect] = api.get(f"/actions/{action_id}/provider-record").json()["effects"]
        assert effect["reference"] == action_id
        assert effect["id"] == store.get(action_id).provider_effect_id


# ------------------------------------------------------------------- /ui mount


@pytest.fixture
def dist(tmp_path):
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<html>console</html>")
    (d / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("outside dist")
    return d


def test_root_redirects_to_ui(offline, dist):
    api = TestClient(create_app(offline, lab=False, web_dist=dist))
    resp = api.get("/", follow_redirects=False)
    assert resp.status_code == 307 and resp.headers["location"] == "/ui/"


def test_ui_serves_assets_and_falls_back_to_index_for_client_routes(offline, dist):
    api = TestClient(create_app(offline, lab=False, web_dist=dist))
    assert api.get("/ui/assets/app.js").text == "console.log(1)"
    assert api.get("/ui/").text == "<html>console</html>"
    assert api.get("/ui/actions/act_123").text == "<html>console</html>"  # SPA route


def test_ui_never_serves_files_outside_dist(offline, dist):
    api = TestClient(create_app(offline, lab=False, web_dist=dist))
    assert "outside dist" not in api.get("/ui/../secret.txt").text
    assert "outside dist" not in api.get("/ui/%2e%2e/secret.txt").text


def test_ui_explains_how_to_build_when_missing(offline, tmp_path):
    resp = TestClient(create_app(offline, lab=False, web_dist=tmp_path / "nope")).get("/ui/")
    assert resp.status_code == 404 and "make web-build" in resp.text


def test_json_api_paths_still_win_over_the_console(offline, dist):
    api = TestClient(create_app(offline, lab=False, web_dist=dist))
    assert api.get("/actions").json() == []
