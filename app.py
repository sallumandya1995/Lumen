"""Standalone Lumen Space: Python front door + local full-stack Worker runtime.

No iframe and no requests to the original ChatGPT Site are used.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import time
import urllib.request

import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import signal

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("LUMEN_CACHE_DIR", "/tmp/lumen-runtime"))
STATE = Path(os.environ.get("LUMEN_STATE_DIR", "/tmp/lumen-state"))
BACKEND = "http://127.0.0.1:8787"
NODE_VERSION = "24.12.0"
NODE_SHA256 = "bdebee276e58d0ef5448f3d5ac12c67daa963dd5e0a9bb621a53d1cefbc852fd"
worker: subprocess.Popen | None = None


def download(url: str, destination: Path, checksum: str | None = None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    try:
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
        if checksum and hashlib.sha256(temporary.read_bytes()).hexdigest() != checksum:
            raise RuntimeError("Downloaded runtime asset failed its checksum.")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def node_environment():
    env = os.environ.copy()
    node = shutil.which("node")
    if node:
        version = subprocess.check_output([node, "-p", "process.versions.node"], text=True).strip()
        if int(version.split(".")[0]) >= 24:
            return env, node
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("Install Node.js 24 before launching on this platform. Hugging Face CPU Spaces use supported Linux x64.")
    home = CACHE / f"node-v{NODE_VERSION}-linux-x64"
    node = str(home / "bin/node")
    if not Path(node).exists():
        print("Installing a checksum-verified Node.js runtime from nodejs.org…", flush=True)
        archive = CACHE / "node.tar.xz"
        download(f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz", archive, NODE_SHA256)
        with tarfile.open(archive) as tar:
            tar.extractall(CACHE, filter="data")
        archive.unlink()
    env["PATH"] = str(home / "bin") + os.pathsep + env.get("PATH", "")
    return env, node


def public_origin():
    from urllib.parse import urlsplit
    host = os.environ.get("SPACE_HOST", "")
    origin = os.environ.get("LUMEN_PUBLIC_ORIGIN") or ("https://" + host if host else "http://localhost:7860")
    parsed = urlsplit(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise RuntimeError("LUMEN_PUBLIC_ORIGIN must be a plain HTTP(S) origin.")
    return f"{parsed.scheme}://{parsed.netloc}"


def prepare_runtime():
    global worker
    CACHE.mkdir(parents=True, exist_ok=True)
    STATE.mkdir(parents=True, exist_ok=True)
    env, node = node_environment()
    env.update({"LUMEN_SPACE_BUILD": "1", "WRANGLER_SEND_METRICS": "false", "CI": "true", "CLOUDFLARE_CF_FETCH_ENABLED": "false"})
    if not (ROOT / "node_modules/vinext").exists():
        print("Installing the application's locked JavaScript dependencies…", flush=True)
        npm = str(Path(node).resolve().parent.parent / "lib/node_modules/npm/bin/npm-cli.js")
        if not Path(npm).exists():
            npm_command = [shutil.which("npm", path=env["PATH"]) or "npm"]
        else:
            npm_command = [node, npm]
        subprocess.run(npm_command + ["exec", "--yes", "--package=pnpm@11.25.0", "--", "pnpm", "install", "--frozen-lockfile"], cwd=ROOT, env=env, check=True)
    manifest = json.loads((ROOT / "runtime-assets.json").read_text())
    for asset in manifest:
        destination = ROOT / asset["path"]
        if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != asset["sha256"]:
            download(asset["url"], destination, asset["sha256"])
    config_path = ROOT / "dist/server/wrangler.json"
    fingerprint = hashlib.sha256(b"".join(p.read_bytes() for p in sorted([p for directory in ['app','lib','drizzle'] for p in (ROOT / directory).rglob('*')]) if p.is_file()) + (ROOT / "pnpm-lock.yaml").read_bytes() + (ROOT / "build/sites-worker.ts").read_bytes()).hexdigest()
    marker = CACHE / "built-fingerprint"
    if not config_path.exists() or not marker.exists() or marker.read_text() != fingerprint:
        print("Building Lumen's actual React interface and server routes…", flush=True)
        subprocess.run([node, "node_modules/vinext/dist/cli.js", "build"], cwd=ROOT, env=env, check=True)
        marker.write_text(fingerprint)
    config = json.loads(config_path.read_text())
    config["name"] = "lumen-standalone-space"
    for binding in config.get("d1_databases", []):
        binding.update(database_name="lumen-space", database_id="00000000-0000-4000-8000-000000000000", migrations_dir=str(ROOT / "drizzle"))
    config_path.write_text(json.dumps(config, indent=2))
    # Only these server values enter the Worker. Never forward the whole process environment.
    values = {"NEBIUS_API_KEY": os.environ.get("NEBIUS_API_KEY", ""), "LUMEN_PUBLIC_ORIGIN": public_origin()}
    secret_path = config_path.parent / ".dev.vars"
    fd = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write("\n".join(f"{key}={json.dumps(value)}" for key, value in values.items()) + "\n")
    cli = [node, "node_modules/wrangler/bin/wrangler.js"]
    common = ["--config", str(config_path), "--persist-to", str(STATE)]
    print("Applying local database migrations…", flush=True)
    subprocess.run(cli + ["d1", "migrations", "apply", "DB", "--local"] + common, cwd=ROOT, env=env, check=True)
    worker = subprocess.Popen(cli + ["dev", "--local", "--ip", "127.0.0.1", "--port", "8787", "--inspector-port", "0", "--log-level", "error"] + common, cwd=ROOT, env=env, start_new_session=True)
    for _ in range(120):
        if worker.poll() is not None:
            raise RuntimeError("The local application runtime stopped; inspect the preceding server log.")
        try:
            with urllib.request.urlopen(BACKEND + "/api/config", timeout=1) as response:
                if response.status == 200:
                    print("Lumen is ready. Frontend and APIs run inside this Space.", flush=True)
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError("The local application runtime did not become ready in time.")


def stop_runtime():
    if worker and worker.poll() is None:
        import signal
        os.killpg(worker.pid, signal.SIGTERM)
        try:
            worker.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(worker.pid, signal.SIGKILL)


HOP_HEADERS = {"host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "accept-encoding"}
MAX_BODY = 24 * 1024 * 1024


class SpaceHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass  # Do not log request headers, credentials, or user prompts.

    def read_body(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            parts = []; total = 0
            while True:
                line = self.rfile.readline(100)
                length = int(line.split(b";", 1)[0].strip(), 16)
                if length == 0:
                    while self.rfile.readline(8192).strip():
                        pass
                    break
                total += length
                if total > MAX_BODY:
                    raise ValueError("Request too large")
                data = self.rfile.read(length)
                if len(data) != length or self.rfile.read(2) != b"\r\n":
                    raise ValueError("Invalid request body")
                parts.append(data)
            return b"".join(parts)
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > MAX_BODY:
            raise ValueError("Request too large")
        body = self.rfile.read(length)
        if len(body) != length:
            raise ValueError("Incomplete request body")
        return body

    def do_request(self):
        if self.path == "/healthz":
            payload = json.dumps({"ready": worker is not None and worker.poll() is None}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(payload))); self.end_headers()
            if self.command != "HEAD": self.wfile.write(payload)
            return
        connection = http.client.HTTPConnection("127.0.0.1", 8787, timeout=300)
        sent_headers = False
        try:
            body = self.read_body()
            # No trusted ChatGPT dispatch exists in this deployment.
            headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_HEADERS and not key.lower().startswith(("oai-", "x-sites-", "x-forwarded-"))}
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in {"transfer-encoding", "connection", "keep-alive", "content-length"}:
                    self.send_header(key, value)
            self.send_header("Connection", "close"); self.end_headers(); sent_headers = True
            self.close_connection = True
            if self.command != "HEAD":
                while True:
                    chunk = response.read1(65536)
                    if not chunk: break
                    self.wfile.write(chunk); self.wfile.flush()
        except ValueError:
            if not sent_headers: self.send_error(413, "Invalid or oversized request")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            if not sent_headers: self.send_error(502, "The application runtime is unavailable. Check the Space startup log.")
        finally:
            connection.close()

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = do_request


if __name__ == "__main__":
    server = None
    def shutdown(signum, frame):
        stop_runtime()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        prepare_runtime()
        server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "7860"))), SpaceHandler)
        server.daemon_threads = True
        server.serve_forever()
    finally:
        if server: server.server_close()
        stop_runtime()
