# Deploy the actual Lumen application

This package contains the complete React/TypeScript interface and API routes. It does not embed or depend on the old hosted Lumen website.

## Hugging Face

1. Create a **Gradio** Space (or change an existing Space's root README metadata to the supplied `sdk: gradio`). Do not use Static: this application has a backend. Account eligibility for compute Spaces is controlled by Hugging Face; this code does not bypass a paid-plan requirement.
2. Extract the ZIP. Upload **all files and folders at its root**, including `app.py`, `requirements.txt`, `README.md`, `app/`, `lib/`, `public/`, `build/`, `scripts/`, `drizzle/`, `db/`, `.openai/`, the package files, and the lockfile. Do not upload the ZIP as the app.
3. Open Space **Settings → Variables and secrets → New secret**. Set `NEBIUS_API_KEY` to your own Token Factory key. Do not add it as a public variable or put it in a file you upload.
4. Commit and wait for startup. The Python entry point installs a verified Node runtime if needed, installs locked dependencies, fetches verified font assets, builds the actual app, migrates its database, and starts the backend.
5. Open **App**. The React interface and all `/api/*` calls use your Space's own origin. No Dockerfile is required.

First startup needs outbound access to nodejs.org, the npm registry, fonts.gstatic.com, and the pinned Matplotlib font asset on GitHub. Model requests go directly from your server runtime to Nebius Token Factory. No ChatGPT Site service token or Cloudflare account is required.

## Runtime architecture

- `app.py`: standard-library Python HTTP server on public port 7860. It starts the local backend, forwards requests and streaming responses, and strips forged platform identity headers.
- Local Node/workerd runtime: bound to loopback port 8787, running the app's compiled API routes and agent executor. It uses local D1/SQLite through Wrangler's local runtime.
- The frontend is the existing React/Vinext application, not a Gradio reimplementation or an iframe.
- `build/sites-worker.ts` normalizes requests to the configured public Space origin so CSRF checks and secure browser-workspace cookies work behind the Hugging Face proxy. Mock ChatGPT authentication is disabled for this build.
- Runtime assets are listed with SHA-256 hashes in `runtime-assets.json`. Font binaries are downloaded at startup to keep the source ZIP small. Their license notices are included.

## Secrets and storage

Only `NEBIUS_API_KEY` is required for live inference. It is passed into the local Worker through a runtime-only `.dev.vars` file with restricted permissions; that file is not in this ZIP and is not served as a frontend asset.

The default database is independent of the old deployment and starts with its own historical examples. Live runs and edits are saved locally in `/tmp/lumen-state`. On an ephemeral Space this state is lost when the container is recreated. Set `LUMEN_STATE_DIR` only to a supported writable POSIX storage volume if you need longer retention; do not assume an object-storage/FUSE mount safely supports SQLite locking. A production shared database requires a separate backend/storage deployment.

Visitors have separate browser-cookie workspaces. There is no ChatGPT account identity provider in this Space. Do not assume the sample team directory provisions real organization accounts. If you publish the Space, visitors can use the backend's shared model credential; choose Space visibility accordingly.

## Local run

Use Python 3.11+ and Node.js 24 on your machine. On Linux x64, the Python entry point can install the pinned Node runtime automatically.

```bash
# Linux/macOS example; provide the credential through your environment.
export NEBIUS_API_KEY='your-own-key'
python3 app.py
```

Open `http://localhost:7860`. For a different externally visible origin, set `LUMEN_PUBLIC_ORIGIN` to that exact HTTP(S) origin. Do not put a path, query, username, or password in this setting.

## Features retained

Explainable Chat, Guided Generation, Experiments, Agent Studio, Governance, Policies, Architecture, PDF evidence export, and the existing Python connector examples are included. Built-in tools remain local functions; remote MCP tools require your external backend configuration. The original application's limitations around per-run memory, held-action resumption, and unavailable pricing metadata still apply.
