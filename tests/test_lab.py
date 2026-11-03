"""Lab mode, presets, reconciliation history, guarantees and the Learn docs API."""

from __future__ import annotations

import time

import httpx
import pytest
from fastapi.testclient import TestClient

from fakeprovider.process import ProviderProcess, free_port
from oneshot.api import create_app
from oneshot.lab import GROUPS, PRESETS
from oneshot.provider_client import ProviderClient
from oneshot.store import ActionStore
from oneshot.worker import Worker
from tests.conftest import CHARGE


@pytest.fixture
def offline(settings):
    return settings.with_overrides(provider_url=f"http://127.0.0.1:{free_port()}")


# ------------------------------------------------------------------ gating


def test_lab_routes_do_not_exist_without_lab_mode(offline, tmp_path):
    api = TestClient(create_app(offline, lab=False, web_dist=tmp_path))
    assert api.get("/lab/presets").status_code == 404
    assert api.post("/lab/presets/happy-path").status_code == 404


def test_presets_are_grouped_and_described(offline, tmp_path):
    body = TestClient(create_app(offline, lab=True, lab_manage=False, web_dist=tmp_path)).get("/lab/presets").json()
    groups = {g["id"] for g in body["groups"]}
    assert {p["group"] for p in body["presets"]} <= groups
    assert all(p["what"] and p["expect"] for p in body["presets"])


def test_process_presets_need_managed_processes(offline, tmp_path):
    api = TestClient(create_app(offline, lab=True, lab_manage=False, web_dist=tmp_path))
    resp = api.post("/lab/presets/worker-kill-mid-request")
    assert resp.status_code == 409 and "ONESHOT_LAB_MANAGE" in resp.json()["detail"]
    assert api.post("/lab/worker/kill").status_code == 409
    assert api.post("/lab/presets/nope").status_code == 404


def test_lab_reports_an_unreachable_provider_instead_of_failing(offline, tmp_path):
    api = TestClient(create_app(offline, lab=True, lab_manage=False, web_dist=tmp_path))
    assert api.get("/lab/state").json()["faults"] is None
    assert api.post("/lab/faults", json={"mode": "timeout"}).status_code == 503


# ------------------------------------------------- presets do what they say


def drain(cfg, seconds: float = 25) -> None:
    store, client = ActionStore(cfg.db_path), ProviderClient(cfg)
    Worker(store, client, cfg, worker_id="lab-test", log=lambda m: None).run(drain=True, max_seconds=seconds)
    client.close()


# preset -> (final statuses of the created actions, number of effects per action)
EXPECTED = {
    "happy-path": (["SUCCEEDED"], [1]),
    "transient-retry": (["SUCCEEDED"], [1]),
    "permanent-decline": (["FAILED"], [0]),
    "timeout-charge": (["SUCCEEDED"], [1]),
    "lost-response-charge": (["SUCCEEDED"], [1]),
    "lost-response-message": (["SUCCEEDED"], [1]),
    "timeout-message": (["SUCCEEDED"], [1]),
    "server-error-after-apply": (["SUCCEEDED"], [1]),
    "agent-retry-same-key": (["SUCCEEDED"], [1]),
    "agent-retry-new-key": (["SUCCEEDED", "SUCCEEDED"], [1, 1]),
    "slow-provider-duplicate": (["SUCCEEDED"], [2]),  # the documented gap
}


@pytest.mark.integration
def test_every_unmanaged_preset_matches_its_description(settings, tmp_path):
    assert set(EXPECTED) == {n for n, p in PRESETS.items() if not p.needs_managed}
    with ProviderProcess(tmp_path / "p.db", timeout_hang=1.5, slow_delay=1.0) as provider:
        cfg = settings.with_overrides(provider_url=provider.url, provider_settle_seconds=1.0)
        api = TestClient(create_app(cfg, lab=True, lab_manage=False, web_dist=tmp_path))
        store = ActionStore(cfg.db_path)
        for name, (statuses, effects) in EXPECTED.items():
            ids = api.post(f"/lab/presets/{name}").json()["action_ids"]
            drain(cfg)
            if name == "slow-provider-duplicate":
                time.sleep(cfg.provider_settle_seconds + 3)  # let the slow original land too
            got = [store.get(i).status.value for i in ids]
            n_effects = [len(provider.effects(reference=i)) for i in ids]
            assert (got, n_effects) == (statuses, effects), name
            api.delete("/lab/faults")


@pytest.mark.integration
def test_managed_supervisor_kills_restarts_and_crashes_processes(settings, tmp_path):
    cfg = settings.with_overrides(db_path=str(tmp_path / "var" / "oneshot.db"), provider_url=f"http://127.0.0.1:{free_port()}")
    with TestClient(create_app(cfg, lab=True, lab_manage=True, web_dist=tmp_path)) as api:
        state = api.get("/lab/state").json()
        assert state["managed"] and state["worker"]["running"] and state["provider"]["running"]

        api.post("/lab/worker/kill")
        state = api.get("/lab/state").json()
        assert not state["worker"]["running"] and not state["worker"]["auto_restart"]
        assert api.post("/lab/worker/kill").status_code == 409  # nothing to kill

        assert api.post("/lab/worker/start").status_code == 200
        # A failpoint crash is followed by an automatic restart (to show recovery).
        api.post("/lab/worker/crash", json={"point": "after_response"})
        action_id = api.post("/actions", headers={"Idempotency-Key": "k"}, json={"type": "payment.charge", "payload": CHARGE}).json()["id"]
        deadline = time.time() + 15
        while time.time() < deadline and api.get("/lab/state").json()["worker"]["restarts"] < 1:
            time.sleep(0.2)
        state = api.get("/lab/state").json()
        assert state["worker"]["restarts"] == 1 and state["worker"]["running"]
        assert any("failpoint" in e["message"] for e in state["events"])

        # Recovery after the lease: one effect, SUCCEEDED.
        deadline = time.time() + cfg.lease_seconds + 10
        while time.time() < deadline and api.get(f"/actions/{action_id}").json()["status"] != "SUCCEEDED":
            time.sleep(0.2)
        assert api.get(f"/actions/{action_id}").json()["status"] == "SUCCEEDED"
        assert len(api.get(f"/actions/{action_id}/provider-record").json()["effects"]) == 1

        api.post("/lab/faults", json={"mode": "crash_before_apply"})
        api.post("/actions", headers={"Idempotency-Key": "k2"}, json={"type": "payment.charge", "payload": {**CHARGE, "amount_cents": 7}})
        deadline = time.time() + 10
        while time.time() < deadline and api.get("/lab/state").json()["provider"]["running"]:
            time.sleep(0.2)
        assert not api.get("/lab/state").json()["provider"]["running"]
        assert api.post("/lab/provider/restart").status_code == 200
        assert api.get("/lab/state").json()["provider"]["running"]
    # Leaving the context runs the lifespan shutdown: the managed provider is gone.
    with pytest.raises(httpx.HTTPError):
        httpx.get(f"{cfg.provider_url}/healthz", timeout=1)


# ------------------------------------------------- history, guarantees, docs


@pytest.mark.integration
def test_reconcile_runs_are_saved_and_guarantees_report_the_duplicate_gap(settings, tmp_path):
    with ProviderProcess(tmp_path / "p.db", slow_delay=1.0) as provider:
        cfg = settings.with_overrides(provider_url=provider.url, provider_settle_seconds=1.0)
        api = TestClient(create_app(cfg, lab=True, lab_manage=False, web_dist=tmp_path))
        api.post("/lab/presets/happy-path")
        drain(cfg)
        g = {x["id"]: x["status"] for x in api.get("/guarantees").json()["guarantees"]}
        assert g == {"G1": "holds", "G2": "holds", "G3": "holds", "G4": "holds", "G5": "holds"}

        api.post("/lab/presets/slow-provider-duplicate")
        drain(cfg)
        time.sleep(4)
        body = api.get("/guarantees").json()
        g = {x["id"]: x for x in body["guarantees"]}
        assert g["G4"]["status"] == "condition-broken" and len(g["G4"]["action_ids"]) == 1
        assert g["G3"]["status"] == "holds"

        first = api.post("/reconcile").json()
        second = api.post("/reconcile?apply=false").json()
        runs = api.get("/reconcile/runs").json()
        assert [r["id"] for r in runs] == [second["run_id"], first["run_id"]]
        assert runs[0]["applied"] is False and "findings" not in runs[0]
        detail = api.get(f"/reconcile/runs/{first['run_id']}").json()
        assert any(f["kind"] == "DUPLICATE_EFFECT" for f in detail["findings"])
        assert api.get("/reconcile/runs/999").status_code == 404
        assert len(api.get("/provider/ledger").json()["effects"]) == 3


def test_guarantees_say_unknown_when_the_provider_is_down(offline, tmp_path):
    body = TestClient(create_app(offline, lab=False, web_dist=tmp_path)).get("/guarantees").json()
    assert body["provider_reachable"] is False
    assert {g["status"] for g in body["guarantees"][1:]} == {"unknown"}


def test_learn_docs_render_includes_and_callouts(offline, tmp_path):
    root = tmp_path / "repo"
    (root / "docs" / "src" / "outputs").mkdir(parents=True)
    (root / "docs" / "src" / "outputs" / "x.txt").write_text("real output\n")
    (root / "docs" / "src" / "01-a.md").write_text(
        '# Doc A\n\n{{include outputs/x.txt}}\n\n<div class="cannot" markdown>\n**Never** exactly-once.\n</div>\n'
    )
    (root / "EXPERIMENTS.md").write_text("# Experiments\n")
    api = TestClient(create_app(offline, lab=False, web_dist=tmp_path, docs_root=root))
    assert [d["slug"] for d in api.get("/learn/docs").json()] == ["01-a", "experiments"]
    md = api.get("/learn/docs/01-a").json()["markdown"]
    assert "```text\nreal output\n```" in md
    assert "> [!cannot]\n> **Never** exactly-once." in md
    assert api.get("/learn/docs/nope").status_code == 404


def test_real_docs_are_listed():
    from oneshot.learn import list_docs

    slugs = [d["slug"] for d in list_docs()]
    assert slugs[0] == "00-overview" and "experiments" in slugs
