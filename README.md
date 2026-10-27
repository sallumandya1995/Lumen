 

# Lumen. — actual standalone application

This repository contains Lumen's **full React frontend and server API implementation**, not an iframe or link to the original website. Its Python entry point runs the application's backend inside this Space, with a separate local database.

## Upload and run

1. Create a **Gradio** Space, not Static. Your account must be eligible to create compute Spaces; selecting this SDK does not bypass Hugging Face's plan rules.
2. Extract the ZIP and upload **all files and folders** to the repository root. Keep this README's YAML configuration.
3. Add a Space **secret** named `NEBIUS_API_KEY` with your own Nebius Token Factory key.
4. Commit and wait for startup. The app installs locked JavaScript dependencies, builds the frontend/server, fetches checksum-verified font assets, and initializes its own database. No Dockerfile or Cloudflare account is required.
5. Open the App tab. All app pages and API routes are served from this Space.

See **[SPACE_SETUP.md](SPACE_SETUP.md)** for deployment details, local startup, storage limitations, and runtime architecture. **[README_PROJECT.md](README_PROJECT.md)** describes the product and original project; references there to the old demo URL are documentation links, not runtime dependencies.

## What is included

Explainable Chat, Guided Generation, Experiments, Agent Studio, Governance, editable YAML policies, Architecture, PDF exports, Python connector examples, and MIT licensing. Nemotron 3 Ultra remains the generation default. Live inference uses your server-side Token Factory secret.

The application uses a Python HTTP front door on port 7860 and a local Node/workerd backend on loopback port 8787. It retains the original TypeScript API routes and executor rather than replacing them with incomplete Python stubs.

The local database is **ephemeral by default** and starts fresh. It does not copy the old deployment's database or chats. Read the storage notes before relying on long-term history. No real API key is included in this source package.
