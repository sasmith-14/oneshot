"""End-to-end: the built web console, served by the real API, against a real provider.

Uses the Playwright + Chromium already installed for the docs build (no second
browser download). Skipped when the console is not built (`make web-build`) or
Playwright/Chromium is unavailable.
"""

from __future__ import annotations

import re
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
        # lab on but not managing processes: fault presets work, process control is off
        app = create_app(cfg, lab=True, lab_manage=False)
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
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
        pg = browser.new_page(viewport={"width": 1360, "height": 900})
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if "ErrorBoundary" in m.text else None)
        yield pg
        browser.close()
        assert not errors, f"the page raised errors: {errors[:3]}"


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
    # the id appears in the wire report too; open it from the full list
    page.locator("#actions").get_by_role("link", name=action_id, exact=True).click()
    page.wait_for_url(f"**/ui/actions/{action_id}")

    # Trace (default tab): one send whose reply was lost, then the ledger check that found the effect.
    page.get_by_role("button", name=re.compile(r"^Send 1: AMBIGUOUS")).wait_for(timeout=5000)
    page.get_by_role("button", name=re.compile(r"^Ledger check 1: FOUND")).click()
    page.get_by_text("The provider's ledger contains the effect.").wait_for(timeout=5000)

    # Sequence: the lost response, the ledger write the client never heard about, the check that found it.
    page.get_by_role("tab", name="Sequence").click()
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
    page.get_by_role("button", name="Investigate and resolve").click()
    page.get_by_text("Evidence: it happened").wait_for(timeout=5000)
    confirm = page.get_by_role("button", name="Resolve as SUCCEEDED")
    assert confirm.is_disabled()  # a note is required
    page.get_by_label("3. Note for the audit trail (required)").fill("ledger shows the effect (e2e test)")
    confirm.click()
    page.locator('article header [data-status="SUCCEEDED"]').first.wait_for(timeout=5000)
    after = store.get(action_id)
    assert after.status.value == "SUCCEEDED" and "web console" in (after.resolution or "")


def test_chaos_preset_then_reconcile_guarantees_and_palette(stack, page):
    cfg, provider, base = stack
    page.goto(f"{base}/ui/chaos")
    card = page.get_by_role("article").filter(has=page.get_by_role("heading", name="Lost response on a charge"))
    card.get_by_role("button", name="Run").click()
    page.get_by_text("Started: Lost response on a charge").wait_for(timeout=5000)
    # process presets are disabled when the API does not manage processes
    kill = page.get_by_role("article").filter(has=page.get_by_role("heading", name="kill -9 mid-request")).get_by_role("button", name="Run")
    assert kill.is_disabled()
    run_worker(cfg)
    page.get_by_role("heading", name="Your runs").wait_for()
    page.locator('[data-status="SUCCEEDED"]').first.wait_for(timeout=5000)

    page.goto(f"{base}/ui/reconcile")
    page.get_by_role("button", name="Run reconciliation").click()
    page.get_by_role("heading", name="Run #1").wait_for(timeout=5000)
    page.get_by_text("Everything agrees").wait_for(timeout=5000)

    page.goto(f"{base}/ui/guarantees")
    for gid in ["G1", "G2", "G3", "G4", "G5"]:
        page.get_by_text(gid, exact=True).wait_for(timeout=5000)
    assert page.get_by_text("Holds", exact=True).count() == 5

    # Command palette: Cmd/Ctrl+K, type, Enter
    page.keyboard.press("ControlOrMeta+k")
    page.get_by_placeholder("Search pages, actions, presets…").fill("Ledger the provider")
    page.keyboard.press("Enter")
    page.wait_for_url("**/ui/ledger")
    page.get_by_role("heading", name="Provider ledger").wait_for()


def test_learn_renders_docs_with_diagrams(stack, page):
    _, _, base = stack
    page.goto(f"{base}/ui/learn")
    page.get_by_role("heading", name="An agent asks for something").wait_for()
    page.get_by_role("link", name=re.compile("Durable Action Tracking")).click()
    page.wait_for_url("**/ui/learn/01-durable-action-tracking")
    page.locator(".mermaid-box svg").first.wait_for(timeout=15000)  # Mermaid loaded lazily and rendered
    page.get_by_role("navigation", name="On this page").wait_for()
    assert page.evaluate("document.documentElement.classList.contains('lenis')")  # smooth scrolling is on


def test_console_works_with_reduced_motion(stack):
    """Every page renders, without errors, when the OS asks for reduced motion."""
    _, _, base = stack
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(reduced_motion="reduce", color_scheme="dark")
        pg = ctx.new_page()
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        for path, heading in [("/ui/", "Live"), ("/ui/chaos", "Chaos"), ("/ui/reconcile", "Reconcile"), ("/ui/ledger", "Provider ledger"), ("/ui/guarantees", "Guarantees"), ("/ui/learn", "Learn")]:
            pg.goto(base + path)
            pg.get_by_role("heading", name=heading, exact=True).wait_for(timeout=5000)
        # no smooth-scroll engine under reduced motion
        assert pg.evaluate("document.documentElement.classList.contains('lenis')") is False
        browser.close()
        assert not errors, errors[:3]
