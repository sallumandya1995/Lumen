# Lumen agent governance prototype

**Agent Studio** defines agents; **Agent governance** monitors the same shared records in a working client-side simulation. Explainable chat and guided generation continue to use their existing Nebius routes. Studio Run agent and Run test call real models through the Site Worker using its existing Nebius secret. Tool adapters and external connectors remain demos: no email is sent or ticket created. The Python sample stores execution receipts; it does not run the model itself.

## Run the frontend

From the repository root, use the project's existing dependency installer, then `npm run dev` (or `pnpm dev`). Open the local URL printed by the dev command and select **Agent governance**. No governance API or credential is required. `npm run build` builds the full app.

The mock feed adds a linked run and tool call every four seconds, periodically creating approvals and policy events. Pause it with **Live feed**. Connector settings offer **Next event**, **Simulate error** with **Retry**, and an owner-only **Reset**. State persists in this browser under `azure-governance-v1`; use Reset for a fresh scenario. The last 180 runs plus all review-referenced runs are retained, with up to 300 audit records; this is a bounded demo, not an archival audit system.

Switch the demo user at the upper right: Workspace owner has the Owner role, Jordan is Admin, Priya and Maya are SMEs, and Sam is a Sub-admin. Admins see assigned agents. SMEs/sub-admins see assigned agents and reviews delegated to them. This is mocked role behavior, not a security boundary. A future backend must enforce permissions independently.

Tables support pagination and screen-specific filters. **Export view** downloads only the matching records in the current role's scope. Review queues include ownership filters, expiry information, and links from run traces to each review's current state. Recorded run outcomes remain historical snapshots after a review decision. An admin's newly saved, unbound connector stays visible to that admin. Expired approvals cannot be decided or reassigned; expiry is recorded once in the audit log. Invalid saved data recovers to fresh demo fixtures, and the HTTP adapter reports malformed responses or connection errors explicitly.

In **Agent Studio**, owners and assigned admins can edit identity, model settings, prompts, tools, sub-agent nodes, graph connections, memory, guardrails, and runtime limits. Saving updates the shared agent and its configuration revision together. Enabled guardrails become the policies shown in Governance. Existing runs and review decisions remain historical records. A stale draft returns a conflict instead of overwriting a newer configuration; a Governance status change also advances the revision. The graph is a validated directed acyclic definition. Studio can execute it with live model calls through the Site Worker or test one saved node in isolation. Results use the same agent and configuration revision in Governance. Persistent memory and real tool integrations remain backend extension points; the current runner uses run-scoped context and demo tools.

Only Agent and Sub-agent nodes generate answers. Input accepts text unchanged, Output returns incoming text, Memory applies configured local redaction/retention, and Guardrail evaluates saved rules. Execution receipts optionally include `tokenUsage: {generation, policy}` on runs and nodes, plus `policyChecks` on nodes. Counts include prompt and response tokens; counters must sum to `tokens`. The sample API preserves the exact `nodeKind`, token breakdown, and sanitized check evidence on each trace step. Older receipts without these fields are accepted.

Runtime stores an editable model ID and `baseUrl`, defaulting to `nvidia/Nemotron-3-Ultra-550b-a55b` at `https://api.tokenfactory.us-central1.nebius.com/v1/`. US Central, US North, and Global TokenFactory base URLs are accepted. Missing URLs in older configurations resolve to the model's original catalog region. The Site's **Import model IDs from Nebius TokenFactory** action reads IDs through `/api/agent-models` using its backend secret; this Python sample stores the configuration and receipts. A listed model must support chat at the selected regional endpoint. New receipts preserve actual runtime endpoints; historical receipts do not acquire inferred endpoint metadata.

The **Policies** tab edits global and agent rules as YAML and validates them in the frontend. `GET /api/global-policies` returns the shared `{revision, updatedAt, updatedBy, rules}` bundle. Owner-only `POST /api/global-policies` accepts `{expectedRevision, rules}`, rejects stale revisions, and records an audit event. Agent files save through the existing configuration endpoint. Global defaults are added only when missing; explicit empty/custom rules remain intact. The Site executor receives the saved global bundle and records its revision in `globalPolicyRevision`; this Python sample preserves that metadata without rewriting prior traces. Global and agent policies both apply, together with runtime approval settings.

## Files and service boundary

- `lib/governance/types.ts`: typed agents, runs, steps, tool calls, policies, approvals, users, assignments, audit events, connectors, and service contract.
- `lib/governance/mock-data.ts`: consistent linked fixture generator, relative to current time.
- `lib/governance/definitions.ts`: seeded agent definitions, configuration validation, and migration of existing browser records.
- `lib/governance/service.ts`: mock mutations, permission checks, persistence, subscriptions, and `createFastApiService` REST adapter.
- `app/governance/dashboard.tsx` and `governance.css`: navigation, charts, filters, drawers, review dialogs, responsive styling.
- `app/studio/studio.tsx` and `studio.css`: shared-agent configuration and graph editing.
- `tests/governance.mjs`: service-level workflow and relationship tests. Run `node tests/governance.mjs`; it also exports the shared Python fixture to `seed.json`.

To switch governance and Agent Studio to the shared HTTP implementation, set **`VITE_API_BASE_URL=http://localhost:8001`** in your ignored local environment before starting/building Vite. Do not include a trailing `/api`: the adapter adds `/api/...`. Configure an HTTPS service origin for a deployed site and allow its exact frontend origin via backend CORS. Restart/rebuild after changing the variable. The hosted app remains in mock mode by default. Browser API requests use `credentials: 'include'`; replace the demo identity with verified session/OIDC authentication before using a real service.

## Run the dummy FastAPI service

Python 3.11+ is recommended. In this directory:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

Run `python -m unittest -v test_main.py` to check the API contract locally.

Visit `http://localhost:8001/docs` for the generated OpenAPI UI. State is in-memory and resets on restart. The fixture is shifted to current time on startup. `DEMO_USER_ID` selects a **server-side fixed demo identity**, default `u-owner`. It is not real authentication. `FRONTEND_ORIGINS` is a comma-separated list of permitted frontend origins. The sample is for local demonstration only; do not expose it as a production governance backend.

The frontend adapter polls the API every four seconds. The Python sample returns fixture records; automatic live run generation is implemented in the browser mock only. Replace the reads with your event store and add SSE/WebSocket streaming when integrating actual agent telemetry.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/agents` | Scoped agent directory shared with Studio |
| `GET /api/agent-definitions` | Scoped prompts, graphs, tools, memory, guardrails, and model/runtime configuration |
| `POST /api/agents/{id}/configuration` | `{agent, definition, expectedRevision}`; validate and save both records atomically, advance revision, record audit; no workflow execution |
| `POST /api/agent-executions` | Ingest a completed or cancelled live execution receipt; validate role, revision, and idempotency; link runs, tools, policies, approvals, and audit records. Does not execute the agent. |
| `GET /api/runs` | Runs with recorded step summaries |
| `GET /api/tool-calls` | Sanitized tool inputs/outputs and checks |
| `GET /api/policy-events` | Visible policy review queue |
| `GET /api/approvals` | Visible approval inbox |
| `POST /api/approvals/{id}/decision` | `{decision, note}`; record only, never execute |
| `POST /api/reviews/{id}/assign` | `{assigneeId, note}`; one current reviewer plus history |
| `POST /api/policy-events/{id}/resolve` | `{note}`; record remediation |
| `GET /api/users` | Demo users, current server identity first |
| `GET /api/assignments` | Assignment history |
| `GET /api/audit-events` | Scoped audit events |
| `GET /api/connectors` | Connector catalog |
| `POST /api/connectors/test` | `{name,type,framework,endpoint}`; no network request |
| `POST /api/connectors` | Save a mock configuration, status `Not tested` |
| `POST /api/agents/{id}/status` | `{status}`; change demo status |
| `POST /api/users/{id}/availability` | `{available}`; update SME/sub-admin availability |

Configuration saves require an Owner or an Admin assigned to the agent. The sample rejects stale revisions, circular or disconnected enabled graph nodes, missing references, unknown tools, and inaccessible agent/connector references before updating either record. Invalid requests do not partially save the draft. A local lock serializes configuration and status updates; a production backend should use a database transaction and persistent revision checks.

The current HTTP adapter loads full scoped lists and filters in the browser. For large datasets, add server-side filter/query parameters and cursor pagination. Review mutations must eventually use transactions, version checks, idempotency keys, expiry checks, and a durable append-only audit store. Approval decisions should be separate from execution; an authorized agent executor must independently validate the approved scope.

## Dummy MCP agent node and backend connector

These examples use the current official Python SDK v2 (`MCPServer`, `Client`). Install the optional dependency separately:

```sh
pip install -r requirements-mcp.txt
mcp run agent_node.py --transport streamable-http
```

The dummy node exposes only `agent_status` and `recent_activity`, returning synthetic metadata and authored decision summaries. In a second shell, explicitly run the backend adapter against the local node:

```sh
AGENT_MCP_URL=http://localhost:8000/mcp python mcp_adapter.py
```

The adapter is backend-only and has a server-configured hostname allowlist. It is never invoked by the dashboard's mock connector test. To integrate CrewAI/LangGraph/custom nodes, adapt their lifecycle callbacks to a shared sanitized event schema and persist that telemetry in FastAPI's storage layer. MCP tool discovery alone does not automatically capture all framework runs or enforce policies.

Keep tokens, OAuth credentials, service account keys, and connector secrets in a backend secret manager or environment, never in a `VITE_` variable, browser localStorage, source, endpoint query string, or API response. Connector forms deliberately have no credential field. Before any real connection, implement verified authorization, tenant scoping, TLS, an endpoint allowlist with DNS/SSRF protections, credential references, redaction, event validation, and backend enforcement. Allow only concise recorded rationale summaries; do not collect or expose hidden chain-of-thought.

Reference documentation: [FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/), [MCP Python SDK](https://py.sdk.modelcontextprotocol.io/), [MCP clients](https://py.sdk.modelcontextprotocol.io/client/).
