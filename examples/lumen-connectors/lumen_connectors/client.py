"""OTLP/HTTP JSON, durable SQLite outbox, retries, and metadata-only spans.

Credentials stay in process memory. Model prompts, completions, tool arguments,
and hidden reasoning are NOT captured automatically.
"""
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import warnings


def clean(value, limit=2000):
    text = re.sub(r"<think>[\s\S]*?(?:</think>|$)", "[private reasoning omitted]", str(value), flags=re.I)
    text = re.sub(r"\b(?:Bearer\s+\S+|sk-[\w-]{12,}|lum_[a-f0-9]{24}\.[a-f0-9]{64}|v1\.[\w-]{20,}\.[\w-]{20,})", "[credential redacted]", text, flags=re.I)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email redacted]", text)
    return text[:limit]


def attr(key, value):
    kind = "boolValue" if isinstance(value, bool) else "intValue" if isinstance(value, int) else "doubleValue" if isinstance(value, float) else "stringValue"
    return {"key": key, "value": {kind: str(value) if kind == "intValue" else value}}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError("Telemetry redirects are refused to protect the connector key")


class LumenClient:
    def __init__(self, endpoint, api_key, agent_id, outbox=".lumen-outbox.sqlite3", auto_flush=True, site_service_token=None):
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Use the exact HTTPS telemetry endpoint, without query or credentials")
        if not re.fullmatch(r"lum_[a-f0-9]{24}\.[a-f0-9]{64}", api_key):
            raise ValueError("Use a Lumen connector key, not the Nebius API key")
        self.endpoint, self.api_key, self.agent_id = endpoint, api_key, agent_id
        self.site_service_token = site_service_token
        self.source = hashlib.sha256((endpoint + agent_id + api_key.split('.')[0]).encode()).hexdigest()
        self.lock = threading.RLock()
        self.send_lock = threading.Lock()
        self.db = sqlite3.connect(outbox, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, body TEXT NOT NULL)")
        self.db.commit()
        if outbox != ":memory:":
            os.chmod(outbox, 0o600)
        self.opener = urllib.request.build_opener(NoRedirect())
        self.last_error = None
        self.stop = threading.Event()
        self.worker = None
        if auto_flush:
            self.worker = threading.Thread(target=self._worker, daemon=True, name="lumen-telemetry")
            self.worker.start()

    @classmethod
    def from_env(cls, **kwargs):
        kwargs.setdefault("site_service_token", os.environ.get("LUMEN_SITE_SERVICE_TOKEN"))
        return cls(os.environ["LUMEN_ENDPOINT"], os.environ["LUMEN_API_KEY"], os.environ["LUMEN_AGENT_ID"], **kwargs)

    def enqueue(self, span):
        body = {"resourceSpans": [{"resource": {"attributes": [attr("lumen.agent.id", self.agent_id), attr("service.name", "lumen-agent")]}, "scopeSpans": [{"scope": {"name": "lumen-connectors", "version": "0.1.0"}, "spans": [span]}]}]}
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode()) > 256000:
            raise ValueError("Telemetry event exceeds 256 KB")
        with self.lock:
            count = self.db.execute("SELECT count(*) FROM outbox WHERE source=?", (self.source,)).fetchone()[0]
            if count >= 10000:
                raise RuntimeError("Lumen outbox is full. Restore connectivity and flush before continuing.")
            self.db.execute("INSERT INTO outbox(source,body) VALUES(?,?)", (self.source, encoded))
            self.db.commit()

    def flush(self, timeout=30):
        """Retry the same saved spans. On failure the queue remains on disk."""
        deadline = time.monotonic() + timeout
        with self.send_lock:
            while time.monotonic() < deadline:
                with self.lock:
                    row = self.db.execute("SELECT id,body FROM outbox WHERE source=? ORDER BY id LIMIT 1", (self.source,)).fetchone()
                if not row:
                    self.last_error = None
                    return
                headers = {"Authorization": "Bearer " + self.api_key, "Content-Type": "application/json"}
                if self.site_service_token:
                    headers["OAI-Sites-Authorization"] = "Bearer " + self.site_service_token
                request = urllib.request.Request(self.endpoint, data=row[1].encode(), headers=headers, method="POST")
                for attempt in range(3):
                    try:
                        with self.opener.open(request, timeout=max(1, min(10, deadline-time.monotonic()))) as response:
                            if response.status != 200:
                                raise RuntimeError("Unexpected telemetry response")
                            json.loads(response.read(256000))
                        with self.lock:
                            self.db.execute("DELETE FROM outbox WHERE id=? AND source=?", (row[0], self.source))
                            self.db.commit()
                        break
                    except Exception as error:
                        code = error.code if isinstance(error, urllib.error.HTTPError) else None
                        detail = "Site access denied; ask the owner for a Sites service-access credential and set LUMEN_SITE_SERVICE_TOKEN" if code == 403 else "Connector key is invalid, expired, or revoked" if code == 401 else f"Telemetry not delivered ({type(error).__name__}{' '+str(code) if code else ''})"
                        self.last_error = detail + "; durable outbox retained"
                        retryable = not isinstance(error, urllib.error.HTTPError) or error.code in (408, 429) or error.code >= 500
                        if not retryable or attempt == 2 or time.monotonic() >= deadline:
                            raise RuntimeError(self.last_error) from None
                        time.sleep(min(2 ** attempt, max(0, deadline-time.monotonic())))
            raise TimeoutError("Telemetry flush deadline reached; queued records remain on disk")

    def _worker(self):
        while not self.stop.wait(1):
            try:
                self.flush(timeout=12)
            except Exception:
                self.stop.wait(5)

    def trace(self, name):
        return Span(self, name, trace_id=uuid.uuid4().hex)

    def close(self):
        self.stop.set()
        if self.worker:
            self.worker.join(timeout=20)
        self.flush()
        with self.lock:
            self.db.close()


class Span:
    def __init__(self, client, name, trace_id, parent="", operation="invoke_agent", tool=None, model=None, span_id=None, start_time_ns=None):
        self.client = client
        self.attrs = {"gen_ai.operation.name": operation}
        if tool:
            self.attrs["gen_ai.tool.name"] = clean(tool, 200)
        if model:
            self.attrs["gen_ai.request.model"] = clean(model, 200)
        self.value = {"traceId": trace_id, "spanId": span_id or uuid.uuid4().hex[:16], "parentSpanId": parent, "name": clean(name, 200), "startTimeUnixNano": str(start_time_ns or time.time_ns()), "status": {"code": 0}}
        self.ended = False
        self._send()

    def _send(self):
        self.client.enqueue({**self.value, "attributes": [attr(k, v) for k, v in self.attrs.items()]})

    def span(self, name, **kwargs):
        return Span(self.client, name, self.value["traceId"], self.value["spanId"], **kwargs)

    def summary(self, text):
        self.attrs["lumen.summary"] = clean(text)

    def usage(self, input_tokens, output_tokens, cost=None):
        self.attrs["gen_ai.usage.input_tokens"] = max(0, int(input_tokens))
        self.attrs["gen_ai.usage.output_tokens"] = max(0, int(output_tokens))
        if cost is not None:
            self.attrs["lumen.cost.usd"] = float(cost)

    def policy(self, rule, action="Flag", severity="Medium", violated=True):
        self.attrs.update({"lumen.policy.rule": clean(rule, 200), "lumen.policy.action": action, "lumen.policy.severity": severity, "lumen.policy.violated": bool(violated)})
        if violated and action in ("Block", "Require approval"):
            self.attrs["lumen.status"] = "Blocked" if action == "Block" else "Awaiting approval"

    def end(self, failed=False, end_time_ns=None):
        if not self.ended:
            self.ended = True
            self.value.update(endTimeUnixNano=str(end_time_ns or time.time_ns()), status={"code": 2 if failed else 1})
            self._send()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc:
            self.summary("Operation failed: " + type(exc).__name__)
        self.end(failed=exc is not None)
        return False
