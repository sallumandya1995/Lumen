# Lumen implementation notes (extended reference)

**Clarity for AI. Confidence in control.** Lumen brings transparency to model choices and visibility to agent governance and safety. Its open-halo logo and subtle glass buttons keep the existing lime, ink, and white palette.

An interactive workspace built with React, TypeScript, [vinext](https://github.com/cloudflare/vinext), and Cloudflare Workers.

## Connected governance and evidence

**Policies now lives inside Agent Governance → Policies · YAML.** Studio, Governance, and Policies read the same server-backed workspace. The default service is `lib/governance/hosted-client.ts`; the old browser implementation is retained in `store-core.ts` for fixtures and tests. `VITE_API_BASE_URL` still selects the optional external FastAPI adapter; the deployed Site uses its own Worker API and D1 database.

- **Run agent / Run test:** the server validates the saved revision, uses the saved model and global policies, records a Running run before execution, persists completed node evidence, and saves the final receipt before emitting completion. “View governance” opens that exact run. The server preserves a cancelled run even if its panel closes. If the executor disappears without a final receipt, a later refresh marks the stale run incomplete and retains the completed steps.
- **External agents:** Studio → Connect and Governance → Connections provide native Python LangGraph/CrewAI adapters, a custom-tool wrapper, and an MCP ClientSession wrapper. Download `/lumen-connectors.zip`; its README and `quickstart.py` describe setup. CrewAI emits a live root immediately and assembles child events in timestamp order after the native event bus flush. Tested against LangGraph 1.2.16, langchain-core 1.7.0, CrewAI 1.15.28, and MCP 1.28.1.
- **Authentication:** public visitors receive an isolated HttpOnly cookie workspace; signed-in visitors use the platform identity. Browser mutation routes check origin. Connector keys are randomly generated, displayed once, stored hashed, expire in 7/30/90 days, are revocable, and authorize telemetry only for their agent. Actual multi-user organization memberships/SME invitations are not provisioned by this release. The sample team is for review assignment; the server workspace owner controls writes.
- **Ingestion:** `POST /api/telemetry/v1/traces` accepts OTLP/HTTP JSON with a scoped Bearer key. It deduplicates span IDs, handles out-of-order children, rejects conflicting final replays and cycles, and links reported tool/policy events. It does not implement protobuf/gRPC/logs/metrics. Connector code executes in the user's Python backend. Saved MCP URLs do not activate remote tools; execution and enforcement remain in that backend.
- **Evidence:** Governance → Evidence & exports provides PDF and JSON, with a single-run shortcut in the inspector. The PDF embeds the entire signed JSON and clearly labels visual excerpt limits. SHA-256 audit links and an ECDSA P-256 checkpoint protect integrity. Local browser verification and `verify_evidence.py` check the signature, chain, and records digest. Pin the public-key fingerprint independently. This is tamper-evident evidence, not immutable storage or proof that an external agent's report is true.
- **Persistence:** D1 tables hold workspace records, keys, and audit links. Compare-and-swap revisions, guarded batched writes, and retries keep each mutation atomic under concurrent runs and reviews. Runtime signing keys remain server-only. No client endpoint can submit a fabricated Studio execution receipt. Existing browser history is imported once with an explicit unverified provenance label.
- **Studio → Governance synchronization:** save in Studio, then open Governance → Agents → the agent → Workflow. Both views consume the same saved `Agent` and `AgentDefinition`; the graph component is shared. Node prompts, tool/agent bindings, enabled state, and all edge endpoints/labels are inspectable. Node deletion removes its incident edges in the same save. Invalid graphs and stale revision saves are rejected atomically; an unsaved draft is never published to Governance. Configuration audit records include node/connection additions and removals. Existing run traces keep their captured revision and node evidence.
- **Refresh behavior:** successful saves invalidate in-flight reads and notify other tabs through BroadcastChannel (storage-event fallback). Visible subscribed views also refresh every 15 seconds and on focus, independently of the activity feed. A lower server revision cannot replace a newer snapshot. Cross-device updates arrive on the next refresh; separate browser/account workspaces remain isolated. Failed reads show retry feedback and never report a save as synchronized without server confirmation.
- **Seeded activity:** the dashboard retains a moving sample feed alongside distinctly labeled real executions. Live refresh ticks every four seconds; sample activity advances at most once every fifteen seconds. Pausing the feed stops its tick requests; configuration refresh continues. Simulation cannot overwrite live run IDs. Review decisions are saved, but approving a held run does not resume or execute its action.

Relevant endpoints: `GET/POST /api/governance/workspace`, `GET/POST /api/governance/keys`, `GET /api/governance/evidence?scope=live|all` (or `runId=...`), and `POST /api/telemetry/v1/traces`. Keep `NEBIUS_API_KEY` in Worker secrets. D1 binding `DB` is declared in `.openai/hosting.json`; Sites applies the migration during publication. For local setup, follow the D1 migration instructions below using `drizzle/0000_redundant_aaron_stack.sql`.

Validation: `node tests/governance-server.mjs` tests the actual route/engine/storage boundaries with a deterministic provider; `node tests/governance-pdf.mjs` renders its signed report. `tests/python-connectors.py` runs real framework callbacks with deterministic local work. Existing execution, policy, and simulation suites remain available. No frontend-only approval or inference claim should be presented as an external action.

Synchronization regression checks: `node tests/governance-client-sync.mjs` covers racing reads/saves, cross-tab signals, storage fallback, polling, and cleanup. `node tests/governance-server.mjs` also covers node/edge add/edit/delete, exact configuration round trips, invalid graph rejection, concurrent writers, and historical run preservation. `node tests/governance-workflow-view.mjs` checks the shared graph’s rendered node/edge data and read-only labels.

## App walkthrough

### Prompt and model experiments

Open **Explainable chat → Experiments** to compare one prompt in fresh context across two to six variants. Each variant has its own Nebius chat model (Nemotron 3 Ultra or DeepSeek V4.1 Flash), temperature, Top P, output budget, and optional system prompt. Duplicate a variant to vary a single setting. Up to three cancellable requests run at once; errors remain local to their variant, and latency excludes queue time. Existing conversations and the original comparison panels are independent of experiments.

Results retain the exact settings used, client-observed latency, provider-reported input/output/total usage, and mean log probability over the recorded visible answer tokens. Provider token usage can include reasoning, so it can exceed the visible-token count. Mean log probability is model-specific and is not a factual-confidence or quality score. If probabilities or usage are missing, their metrics remain unavailable. A response reaching its token budget is labeled incomplete.

Choose any successful response as the baseline. Text is aligned before changes are mapped onto the provider's token boundaries, so different tokenizers do not create false differences for identical text. Hover retains the existing top-token probability inspector. Omitted baseline text is shown separately. Long comparisons use a bounded, broader changed region; missing token alignment uses labeled text highlighting.

**Cost rates** accepts custom input and output prices in USD per million tokens. Estimated cost is `(input tokens × input rate + output tokens × output rate) / 1,000,000`, using provider usage and the rates captured at run time. Both rates must be supplied; missing prices or usage never imply a free request. Estimates exclude discounts/taxes. Model changes clear rates to prevent reusing another model's price. Configure the current rates from your Nebius account; the app does not invent a pricing catalog.

**Export PDF** downloads a real paginated report containing the shared prompt, all variant settings/system prompts, metrics, full responses, baseline differences, and a token-evidence appendix (first 100 tokens and up to three alternatives per row). The full original UTF-8 experiment data, including all returned token alternatives, is embedded as `lumen-experiment-data.json`. A bundled DejaVu font supports common Unicode; unsupported glyphs use code-point escapes in the printed report, with original text preserved in its attachment. PDF generation happens in the browser and uses no additional model requests. `public/fonts/DejaVu-LICENSE.txt` accompanies the font.

Experiment settings are saved under `lumen-experiment-settings-v1` in this browser. Results remain in the mounted session; running again replaces them, so export first to retain a run. **New conversation** while in Experiments resets the experiment. Focused checks: `node tests/experiments.mjs`, `node tests/experiment-chat-route.mjs`, and `node tests/experiment-pdf.mjs` (the last creates an ignored PDF fixture for rendering QA).

- **Explainable chat** (`/#chat`): ask a question, inspect the actual alternatives below any response token, edit/resend a prompt, retry or regenerate a response, and tune generation settings. Use **+** beside a model picker to add a chat on the right, up to four panels. A new panel copies that conversation and its settings, then keeps its own model, parameters, history, draft, and cancellation. **Send to all** sends the same prompt to every panel using each panel's current settings and conversation; ordinary Send remains independent. Shared images are read once before broadcasting. New conversation clears all panels while retaining their models and settings. Closing a panel stops only its request. The chat API returns the full answer with recorded log probabilities; the waiting indicator does not simulate token streaming.
- **Guided generation** (`/#guided`): compare up to 20 provider candidates, preserve spaces when adding custom text, use Play to automatically select the highest-probability usable token until an end token/provider completion (or the existing 16,000-character limit), stop and resume without losing text, undo/redo selections, revisit selection history, and copy or download your draft. Playback sends one serial next-token request per selection; it cancels on Stop, reset, or leaving the tab and stops on errors. Text added with **Add text & predict** stays highlighted in the draft. Hover, tap, or focus a model-selected token to see its recorded log probability, probability, and up to 20 ranked alternatives. The token inspector’s **Revert to here** action keeps the selected token and earlier draft, moves the later continuation to Redo, and requests next-token choices for that exact prefix. Stop active generation before reverting. Metadata follows manual choices, Play, undo/redo, and browser reload without extra API calls for hovering. Manually supplied text is labeled as yours and has no invented model probability. Older saved drafts keep their text; past source/probability data cannot be recovered because it was not recorded. Drafts persist in this browser.
- **Agent governance** (`/#governance`): explore nine connected screens with a live dummy feed, filtered and paginated records, scoped JSON export, review decisions, delegation, connector flows, and audit records. The local simulation appends recent linked sample activity when saved history has aged out of the chart window, retaining saved configurations, review decisions, and live execution receipts. Sparse two-hour history remains available alongside the latest feed events. Charts animate on the four-second telemetry updates, with pause and reduced-motion support. API mode uses backend-provided records. Switch the demo role to inspect permissions.
- **Agent Studio** (`/#studio`): define the same agents through their directed workflow graph, sub-agents, prompts, allowed tools, memory settings, guardrails, model, and execution limits. Double-click a node (or press Enter) to inspect/edit it, save its configuration, and run an isolated test. Run agent executes a saved graph with live model calls and streams node progress. Owner/admin saves and execution results update governance immediately. Both tabs share the selected demo role and one underlying store. The workspace owner uses a generic role label.
- **Policies** (`/#policies`): edit `global.yaml` and agent-specific YAML files, validate the schema, inspect rules, import/download YAML, and save to the same configuration used by Studio and Governance. Owners manage global rules; owners and assigned admins manage agent rules. Other roles can inspect their scoped files.

Run `npm run dev` for development and `npm run build` for a standalone build after installing the locked dependencies. Nebius credentials belong in the server's `NEBIUS_API_KEY` secret. Governance works with local dummy data by default; set `VITE_API_BASE_URL` only when a separately running API is ready.

The [governance README](examples/governance-backend/README.md) documents the FastAPI boundary, Python demo, MCP node, endpoint contract, and deployment considerations. The same Python sample is downloadable from Connectors & settings. Agent Studio uses `GET /api/agent-definitions` and `POST /api/agents/{id}/configuration` on the same service boundary. Configuration revisions prevent an old draft from silently replacing newer changes. Existing browser snapshots are upgraded in place, preserving review decisions and run history.

## Lumen-Agent dashboard assistant

Open **Lumen-Agent** in the bottom-right corner of Agent Governance. Each section offers three relevant starter questions. Ask a custom question to receive a real Nemotron answer from the existing server-side Nebius connection. The assistant is read-only; decisions, assignments, and configuration changes remain explicit dashboard actions.

Each question captures the current role-scoped store, section, active filters, exact overview metrics, per-agent/tool aggregates, and bounded record summaries. The server narrows those samples to the question and groups evidence by exact agent IDs, preserving recorded statuses and reporting omitted records. Filtered table totals are distinct from full-window overview totals. Sample limits and snapshot timestamps are supplied to the model; unknown live costs remain unavailable. Live model receipts and simulated telemetry are labeled separately. Connector endpoints, full execution outputs, secrets, and hidden reasoning are excluded from the context. Changing the demo user, role, or assigned agents resets the assistant and cancels its outstanding request. Conversation stays in memory only; minimizing preserves it until the governance tab is closed.

`lib/governance/assistant-context.ts` builds the snapshot. `POST /api/governance-chat` validates bounded JSON and history, uses `nvidia/Nemotron-3-Ultra-550b-a55b` at the existing central1 endpoint, and returns only a final answer, model ID, and snapshot timestamp. The browser never receives `NEBIUS_API_KEY`. Backend logic is in `lib/governance/assistant-server.ts`; the floating UI is in `app/governance/lumen-agent.tsx`. Cancellation, retry, and new-chat controls are available. Each question sends the selected context to Nebius; it does not perform autonomous actions.

The demo role is a browser UI scope, **not server authorization**. For a production FastAPI integration, build this snapshot on the backend from a verified user session and authorized database queries instead of accepting a browser-supplied role or records. Keep provider secrets on that backend.

Validation: `node tests/governance-assistant-context.mjs` and `node tests/governance-assistant-server.mjs` cover role scoping, filters and metric denominators, unknown costs, payload limits, and mocked provider behavior.

## Image input

Paste an image with Ctrl/⌘ + V into the chat composer, guided prompt, or guided custom-text input. The image button also accepts PNG, JPEG, and WebP files. Each message/guided session supports three images, up to 10 MB per original. Images are resized to a maximum 1600-pixel edge and a bounded upload size before sending; previews can be removed before use. Pasting ordinary text still works. An image can be sent without accompanying text.

`POST /api/images/describe` reads each new image with `nvidia/Nemotron-3.5-Super-VL` at `https://api.tokenfactory.nebius.com/v1/`, using the existing server-only `NEBIUS_API_KEY`. The selected chat/guided model then receives the visible image description and transcription as context. Token probabilities come from that selected generation model, not the image reader. The UI exposes the derived context for inspection; it can miss details or contain errors. Failed image reads stop generation and allow retry. The first read adds a model request; completed image context is reused in follow-ups, edits, retries, Play, and subsequent predictions.

Guided snapshots save derived context and image names, but never base64 pixels in localStorage. After reload, a saved-context placeholder replaces the original thumbnail. If an unread image was present at reload, the app asks to reset and attach it again instead of silently continuing without it. Reset keeps current prompt/images; New conversation starts fresh. Images added during a draft invalidate old next-token choices and become context for subsequent predictions; they do not insert text into the draft.

The upload endpoint accepts bounded base64 data only, checks file signatures, and does not fetch external image URLs. See [Nebius image inputs](https://docs.tokenfactory.nebius.com/api-reference/examples/vision-capabilities) and [the current vision model announcement](https://nebius.com/blog/posts/three-new-open-weight-models-from-us-companies-give-builders-more-choice). Tests: `node tests/image-context.mjs` and `node tests/image-attachments.mjs`.

## Live graph execution

Agent Studio runs saved directed acyclic graphs through `POST /api/agent-run`, a Cloudflare Worker endpoint that streams newline-delimited JSON (`start`, `node-start`, `node-result`, `complete`, `error`). The server uses the existing `NEBIUS_API_KEY`; credentials never enter the payload or browser storage. Nemotron 3 Ultra is the default and uses `https://api.tokenfactory.us-central1.nebius.com/v1/`. Runtime lets owners and assigned admins edit the exact model ID and base URL, as well as temperature and output-token settings. US Central, US North, and Global TokenFactory endpoints are supported. Known suggestions select their matching regional URL; other chat model IDs can be pasted from TokenFactory. Saved model IDs and endpoints are used by both node tests and full runs, and generation receipts record the actual role endpoint.

**Import model IDs from Nebius TokenFactory** loads identifiers for the selected region through `GET /api/agent-models?baseUrl=...`. This server route calls Nebius's [List models API](https://docs.tokenfactory.nebius.com/api-reference/models/list-models), keeps credentials server-side, and returns only bounded model identifiers. Importing updates suggestions without changing or saving the selected runtime. A listed model may serve a different task; choose a chat-compatible model and verify it with **Run test**. The server validates regional URLs before attaching credentials and refuses redirects. Existing saved definitions without a base URL inherit their model's original region, including US North for DeepSeek V4.1 Flash; historical run records are preserved.

1. Select an agent, edit its graph/prompts/runtime, and **Save changes**.
2. Choose **Run agent**, supply a task, and start the saved workflow. Each node receives its predecessors' outputs. Stop cancels pending model work and keeps completed node results.
3. Double-click a node, or use its keyboard control, to inspect its instructions and settings. **Run test** executes only that saved node against your test input; it does not run its predecessors. Save edits before testing them.
4. Open Governance → Runs & performance → **Live model runs & tests** to inspect the same result, revision, trace, policies, and approval records. Simulation records remain separately labeled.

For a complete demonstration, select **Try end-to-end example** from an agent’s run panel, or select **Lumen · End-to-end workflow** in Agent Studio. Its separate saved workflow runs **Input → synthetic CRM lookup → triage agent → specialist review → run memory → Output**. The default template has no approval checkpoint or blocking policy rules and includes only a read-only synthetic CRM adapter. The two writing roles make real Nemotron calls; no external message, ticket, or refund is performed. Click **Run agent** to start after reviewing the editable sample input. Existing agents and approval rules are preserved. New and existing local demo workspaces receive this example once; saved edits to it are not reset. The automatic dummy feed excludes it so its run history reflects explicitly requested tests. External API mode must supply its own saved example.

Run panels open with an editable sample task tailored to the selected agent. Each node test also starts with sample incoming context appropriate to its node kind and configured tool. **Reset sample** restores the example; configuration saves and ordinary rerenders keep your current edits. The samples are synthetic and execute only when you choose **Run agent** or **Run test**.

Run and node-test traces label completed tools as **Tool · Success** with a concrete function-completion message. Built-in tool results include `status: "success"`, `execution: "local_function"`, and `runtime: "TypeScript"`; this confirms a local function returned its result, not an external CRM lookup, email delivery, or ticket creation. Pending, blocked, and failed steps retain their actual status. Runtime limitations are available under **Execution details**. Historical receipts keep their original source metadata.

Node tests describe the node's actual operation. Input accepts the task unchanged; Agent and Sub-agent generate a response; Tool returns a local function result; Memory applies configured identifier redaction and line retention; Guardrail records the rules it evaluated and passes permitted context onward; Output returns the incoming result without generating another response. Test an Agent node or use **Run agent** to get a generated answer. An isolated Output test receives the text you supply, because preceding nodes do not run.

New receipts include provider-reported token totals split into generation calls and policy checks. Both categories include prompt and response tokens. An Input test can therefore report policy tokens while returning the accepted input unchanged. Each node records actual evaluated policy checks, including passes and violations; a missing or malformed provider response never becomes a passing check. Studio and Governance retain this evidence, while older receipts continue to show their original totals. Standalone Guardrail tests evaluate all enabled rules once.

Policy YAML uses `version: 1`, `scope: global` or `scope: agent`, an exact `agent_id` for agent files, and a `policies` list. Each rule has `id`, `name`, `description`, `enabled`, `stage`, `action`, and `severity`. Defaults are provided in [examples/policies](examples/policies): global credential protection, tenant isolation, and external-action review, alongside each agent's existing domain rules. Files reject wrong scopes, duplicate keys/IDs, unknown fields, unsupported values, aliases, and oversized input before saving. Saved rules are canonical shared data; the editor produces readable YAML from them.

Global policy changes have their own revision, owner-only write checks, and audit events. Agent policy edits advance the agent configuration revision. Unsaved drafts and stale-revision conflicts remain visible. Global rules are inherited alongside local guardrails during node tests and graph runs, with distinct scoped IDs. Runtime approval settings also apply. Receipts retain the global policy revision used for execution; historical runs are never rewritten. Existing local workspaces receive global defaults only when the field is missing, preserving explicitly empty or edited policies. FastAPI mode uses `GET /api/global-policies` and `POST /api/global-policies` with `{expectedRevision, rules}`; agent files use the existing agent configuration endpoint.

Existing local workspaces also refresh the end-to-end template's original wording, including its old instructions to label every memo as a demonstration. Only fields that still exactly match the shipped defaults are updated. Custom prompts and labels, graph settings, approval rules, revisions, and historical records are preserved.

Agent and sub-agent steps make real Nebius calls. A linked sub-agent invokes the referenced agent's saved role prompt/model; it does not recursively execute that agent's entire graph. Tools are deterministic demo adapters: no live web search, CRM/database access, email delivery, or ticket creation occurs. Configured connector URLs are never fetched. Memory is limited to context within this run; persistent agent/workspace/vector memory requires an external backend. Guardrail evaluation uses bounded model checks and can block or hold a run for review; it is not a hardened security policy engine. Approval records do not automatically resume or execute an external action.

Execution respects graph order, enabled nodes, step limits, timeouts, and bounded retries. Token usage comes from provider usage metadata. When pricing metadata is unavailable, cost is labeled unavailable and the USD budget is not enforced; no zero-cost claim is made. Historical traces retain their configuration revision. Saving a new definition never rewrites prior traces.

`lib/agent-execution/engine.ts` owns execution, `client.ts` reads its cancellable stream, and `types.ts` defines the contract. `recordExecution` writes receipts to the shared browser store or `POST /api/agent-executions` through the FastAPI adapter. The Python sample ingests receipts; live inference still runs through the Site Worker. Browser role switching is demo authorization, not server authentication. Keep the hosted Site owner-private until production identity, durable storage, and server authorization are implemented.

Validation: `node node_modules/typescript/bin/tsc --noEmit --incremental false`, `node tests/guided-autoplay.mjs`, `node tests/guided-response.mjs`, `node tests/agent-client.mjs`, `node tests/agent-execution.mjs`, `node tests/nebius-adapter.mjs`, `node tests/execution-records.mjs`, `node tests/governance.mjs`, and `python -m unittest -v test_main.py` in `examples/governance-backend` after installing its requirements. The governance test refreshes the shared synthetic `seed.json` fixture. Browser layout and interaction checks are separate from these checks.

The remaining sections describe the underlying Sites runtime and optional platform integrations.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
