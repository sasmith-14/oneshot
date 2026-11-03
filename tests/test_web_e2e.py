"""End-to-end: the built web console, served by the real API, against a real provider.

Uses the Playwright + Chromium already installed for the docs build (no second
browser download). Skipped when the console is not built (`make web-build`) or
Playwright/Chromium is unavailable.
"""

from __future__ import annotations

import threading
import time

import httpx
import pytest

from fakeprovider.process import ProviderProcess, free_port
from oneshot.api import DEFAULT_WEB_DIST, create_app
from oneshot.provider_client import ProviderClient
from oneshot.store import ActionStore
from oneshot.worker import Worker

pytestmark = [pytest.mark.integration, pytest.mark.e2e]

playwright = pytest.importorskip("playwright.sync_api")
uvicorn = pytest.importorskip("uvicorn")

if not (DEFAULT_WEB_DIST / "index.html").is_file():
    pytest.skip("web console not built (run `make web-build`)", allow_module_level=True)


@pytest.fixture
def stack(settings, tmp_path):
    with ProviderProcess(tmp_path / "p.db") as provider:
        cfg = settings.with_overrides(provider_url=provider.url, provider_settle_seconds=0.5)
        port = free_port()
        server = uvicorn.Server(uvicorn.Config(create_app(cfg, lab=False), host="127.0.0.1", port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        while not server.started:
            time.sleep(0.05)
        yield cfg, provider, f"http://127.0.0.1:{port}"
        server.should_exit = True
        thread.join(5)


@pytest.fixture
def page():
    with playwright.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as exc:  # noqa: BLE001
            pytest.skip(f"Chromium not available: {exc}")
        yield browser.new_page()
        browser.close()


def run_worker(cfg) -> None:
    store, client = ActionStore(cfg.db_path), ProviderClient(cfg)
    Worker(store, client, cfg, worker_id="e2e-worker", log=lambda m: None).run(drain=True, max_seconds=20)
    client.close()


def test_lost_response_story_is_visible_in_the_console(stack, page):
    cfg, provider, base = stack
    provider.add_faults({"mode": "lost_response"})
    resp = httpx.post(
        f"{base}/actions",
        headers={"Idempotency-Key": "e2e-1"},
        json={"type": "message.send", "payload": {"to": "+1555", "body": "hi"}},
    )
    action_id = resp.json()["id"]
    run_worker(cfg)

    page.goto(f"{base}/ui/")
    page.get_by_role("link", name=action_id).click()
    page.wait_for_url(f"**/ui/actions/{action_id}")

    # Flow: the lost response, the ledger write the client never heard about, the check that found it.
    flow = page.get_by_role("img", name="Message flow between agent, OneShot, provider and ledger")
    for text in ["no usable response", "recorded", "found: it happened"]:
        # match the visible SVG <text> labels, not the hidden <title> tooltips
        flow.locator("text").filter(has_text=text).first.wait_for(timeout=5000)

    page.get_by_role("tab", name="Timeline").click()
    page.get_by_text("The provider's ledger has the effect. It did happen").first.wait_for(timeout=5000)

    page.get_by_role("tab", name="Ledger").click()
    page.get_by_text("Match", exact=True).wait_for(timeout=5000)


def test_unknown_action_can_be_resolved_with_evidence(stack, page):
    cfg, provider, base = stack
    store = ActionStore(cfg.db_path)
    # Craft an UNKNOWN whose effect exists at the provider: crash the provider after it applies.
    provider.add_faults({"mode": "crash_after_apply"})
    action_id = httpx.post(
        f"{base}/actions",
        headers={"Idempotency-Key": "e2e-2"},
        json={"type": "message.send", "payload": {"to": "+1555", "body": "x"}},
    ).json()["id"]
    run_worker(cfg)  # provider is down: lookups fail -> UNKNOWN
    assert store.get(action_id).status.value == "UNKNOWN"
    provider.restart()

    page.goto(f"{base}/ui/actions/{action_id}")
    page.get_by_role("button", name="Investigate & resolve").click()
    page.get_by_text("Evidence: it happened").wait_for(timeout=5000)
    confirm = page.get_by_role("button", name="Resolve as SUCCEEDED")
    assert confirm.is_disabled()  # a note is required
    page.get_by_label("3. Note for the audit trail (required)").fill("ledger shows the effect (e2e test)")
    confirm.click()
    page.locator('[data-slot="card-header"] [data-status="SUCCEEDED"]').first.wait_for(timeout=5000)
    after = store.get(action_id)
    assert after.status.value == "SUCCEEDED" and "web console" in (after.resolution or "")
