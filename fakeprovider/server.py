"""HTTP server for the fake external provider.

Built on the standard library's ``http.server`` *on purpose*: it gives direct
control over the socket, so failure modes are real rather than mocked. A
"lost response" really closes the TCP connection without writing a byte; a
"crash" really calls ``os._exit``; a "timeout" really holds the connection
open until the client gives up.

Public API (what OneShot uses):

* ``POST /v1/charges``   — honours ``Idempotency-Key`` (like Stripe-style payment APIs).
* ``POST /v1/messages``  — legacy endpoint: does NOT honour idempotency keys.
* ``GET  /v1/effects``   — list every applied effect (optionally ``?reference=``).
* ``GET  /healthz``

Admin API (test/demo scaffolding only):

* ``POST   /_admin/faults`` — push fault rules (object or list of objects).
* ``GET    /_admin/faults`` — inspect the queue.
* ``DELETE /_admin/faults`` — clear the queue.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from fakeprovider.faults import FaultMode, FaultPlan, FaultRule
from fakeprovider.ledger import Effect, ProviderLedger

CRASH_EXIT_CODE = 3


@dataclass
class ProviderConfig:
    db_path: str
    host: str = "127.0.0.1"
    port: int = 8701
    idempotency_ttl_seconds: float = 24 * 3600
    timeout_hang_seconds: float = 5.0  # how long TIMEOUT holds a connection
    slow_delay_seconds: float = 3.0  # how long SLOW_SUCCESS waits before applying
    quiet: bool = False


# ---------------------------------------------------------------------------
# Endpoint catalogue. Adding a new kind of effect = adding one entry here.
# ---------------------------------------------------------------------------


class InvalidRequest(Exception):
    pass


def _validate_charge(body: dict[str, Any]) -> None:
    amount = body.get("amount_cents")
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise InvalidRequest("amount_cents must be a positive integer")
    if not isinstance(body.get("currency"), str) or len(body["currency"]) != 3:
        raise InvalidRequest("currency must be a 3-letter code")
    if not isinstance(body.get("customer"), str) or not body["customer"]:
        raise InvalidRequest("customer is required")


def _validate_message(body: dict[str, Any]) -> None:
    if not isinstance(body.get("to"), str) or not body["to"]:
        raise InvalidRequest("to is required")
    if not isinstance(body.get("body"), str) or not body["body"]:
        raise InvalidRequest("body is required")


@dataclass(frozen=True)
class EndpointSpec:
    kind: str
    honours_idempotency_key: bool
    validate: Callable[[dict[str, Any]], None]


ENDPOINTS: dict[str, EndpointSpec] = {
    "/v1/charges": EndpointSpec("charge", honours_idempotency_key=True, validate=_validate_charge),
    "/v1/messages": EndpointSpec("message", honours_idempotency_key=False, validate=_validate_message),
}

# A deterministic business rule so permanent failures exist without fault injection.
DECLINED_CUSTOMER = "cus_declined"


def request_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


class ProviderServer(ThreadingHTTPServer):
    daemon_threads = True  # hung TIMEOUT handlers must not block shutdown

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self.ledger = ProviderLedger(config.db_path)
        self.faults = FaultPlan()
        cleared = self.ledger.clear_abandoned_reservations()
        super().__init__((config.host, config.port), ProviderHandler)
        self.log(
            f"listening on http://{config.host}:{self.server_address[1]} "
            f"ledger={config.db_path} idempotency_ttl={config.idempotency_ttl_seconds:g}s"
            + (f" (cleared {cleared} abandoned key reservation(s) from a previous crash)" if cleared else "")
        )

    def log(self, message: str) -> None:
        if not self.config.quiet:
            print(f"[provider] {message}", file=sys.stderr, flush=True)


class ProviderHandler(BaseHTTPRequestHandler):
    server: ProviderServer
    protocol_version = "HTTP/1.0"  # one request per connection: simplest model to reason about

    # Silence the default per-request access log; we log meaningful events ourselves.
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass

    # ---------------------------------------------------------------- helpers

    def _send_json(self, code: int, body: Any, headers: dict[str, str] | None = None) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def _drop_connection(self) -> None:
        """Close the socket without sending any HTTP response."""
        self.close_connection = True
        # Returning without writing anything makes the server close the socket.

    def _read_json(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw or b"null")

    # ------------------------------------------------------------------ routes

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path == "/healthz":
            self._send_json(200, {"ok": True})
        elif url.path == "/v1/effects":
            reference = parse_qs(url.query).get("reference", [None])[0]
            effects = self.server.ledger.effects(reference=reference)
            self._send_json(200, {"effects": [e.to_json() for e in effects]})
        elif url.path == "/_admin/faults":
            self._send_json(200, {"faults": self.server.faults.snapshot()})
        else:
            self._send_json(404, {"error": "not_found"})

    def do_DELETE(self) -> None:  # noqa: N802
        if urlparse(self.path).path == "/_admin/faults":
            self.server.faults.clear()
            self._send_json(200, {"faults": []})
        else:
            self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self._read_json()
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid_json", "applied": False})
            return
        if path == "/_admin/faults":
            self._admin_add_faults(body)
        elif path in ENDPOINTS:
            self._handle_effect_request(path, ENDPOINTS[path], body)
        else:
            self._send_json(404, {"error": "not_found"})

    def _admin_add_faults(self, body: Any) -> None:
        items = body if isinstance(body, list) else [body]
        try:
            rules = [FaultRule.from_json(item) for item in items]
        except (KeyError, ValueError, TypeError) as exc:
            self._send_json(400, {"error": f"invalid fault rule: {exc}"})
            return
        self.server.faults.add(rules)
        self.server.log("fault queue: " + ", ".join(r.mode.value for r in rules) + " added")
        self._send_json(200, {"faults": self.server.faults.snapshot()})

    # --------------------------------------------------------- the core logic

    def _handle_effect_request(self, path: str, spec: EndpointSpec, body: Any) -> None:
        srv = self.server
        if not isinstance(body, dict):
            self._send_json(400, {"error": "invalid_request", "message": "JSON object expected", "applied": False})
            return
        try:
            spec.validate(body)
        except InvalidRequest as exc:
            self._send_json(400, {"error": "invalid_request", "message": str(exc), "applied": False})
            return

        reference = body.get("reference")
        key = self.headers.get("Idempotency-Key") if spec.honours_idempotency_key else None
        tag = f"POST {path} ref={reference} key={key or '-'}"

        # 1) Duplicate protection (only on endpoints that honour keys).
        if key is not None:
            decision, record = srv.ledger.reserve_key(key, request_hash(body), srv.config.idempotency_ttl_seconds)
            if decision == "replay":
                assert record is not None
                srv.log(f"{tag} -> REPLAY of stored response (no new effect)")
                self._send_json(record.response_code or 200, record.response_body, {"Idempotent-Replayed": "true"})
                return
            if decision == "in_progress":
                srv.log(f"{tag} -> 409 original request with this key is still in progress")
                self._send_json(409, {"error": "request_in_progress"})
                return
            if decision == "mismatch":
                srv.log(f"{tag} -> 422 key reused with a different request body")
                self._send_json(422, {"error": "idempotency_key_reused", "applied": False})
                return

        # 2) Fault injection decides how this request is (mis)handled.
        rule = srv.faults.take(path, reference)
        mode = rule.mode
        tag = f"{tag} mode={mode.value}"

        def release() -> None:
            if key is not None:
                srv.ledger.release_key(key)

        if mode is FaultMode.DECLINE or body.get("customer") == DECLINED_CUSTOMER:
            answer = {"error": "declined", "applied": False}
            if key is not None:
                srv.ledger.complete_key_without_effect(key, 402, answer)
            srv.log(f"{tag} -> 402 declined (not applied)")
            self._send_json(402, answer)
            return

        if mode is FaultMode.UNAVAILABLE:
            release()
            srv.log(f"{tag} -> 503 unavailable (not applied)")
            self._send_json(503, {"error": "unavailable", "applied": False})
            return

        if mode is FaultMode.TIMEOUT:
            hang = rule.delay_seconds if rule.delay_seconds is not None else srv.config.timeout_hang_seconds
            srv.log(f"{tag} -> hanging {hang:g}s, will NOT apply, then drop connection")
            time.sleep(hang)
            release()
            self._drop_connection()
            return

        if mode is FaultMode.CRASH_BEFORE_APPLY:
            srv.log(f"{tag} -> CRASHING before applying (exit {CRASH_EXIT_CODE})")
            os._exit(CRASH_EXIT_CODE)

        if mode is FaultMode.SLOW_SUCCESS:
            delay = rule.delay_seconds if rule.delay_seconds is not None else srv.config.slow_delay_seconds
            srv.log(f"{tag} -> processing slowly ({delay:g}s) before applying")
            time.sleep(delay)

        # 3) Apply the effect: ledger insert + key completion in ONE transaction.
        effect, response = srv.ledger.apply_effect(
            kind=spec.kind,
            reference=reference,
            idempotency_key=key,
            payload=body,
            response_code=201,
            response_builder=lambda e: _effect_response(e),
        )

        if mode is FaultMode.LOST_RESPONSE:
            srv.log(f"{tag} -> APPLIED {effect.id}, response deliberately dropped")
            self._drop_connection()
            return
        if mode is FaultMode.CRASH_AFTER_APPLY:
            srv.log(f"{tag} -> APPLIED {effect.id}, then CRASHING (exit {CRASH_EXIT_CODE})")
            os._exit(CRASH_EXIT_CODE)
        if mode is FaultMode.ERROR_AFTER_APPLY:
            # The effect and its idempotency key are already committed, so a
            # same-key retry will be answered with a replay of the 201.
            srv.log(f"{tag} -> APPLIED {effect.id}, then answering 500 (bug after commit)")
            self._send_json(500, {"error": "internal_error"})
            return

        srv.log(f"{tag} -> APPLIED {effect.id}, responding 201")
        try:
            self._send_json(201, response)
        except (BrokenPipeError, ConnectionResetError):
            # SLOW_SUCCESS: the client already gave up. The effect is applied anyway.
            srv.log(f"{tag} -> client had already disconnected; effect {effect.id} stands")


def _effect_response(effect: Effect) -> dict[str, Any]:
    return {"id": effect.id, "object": effect.kind, "status": "applied", "reference": effect.reference}


def serve(config: ProviderConfig) -> None:
    server = ProviderServer(config)
    try:
        server.serve_forever(poll_interval=0.1)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
