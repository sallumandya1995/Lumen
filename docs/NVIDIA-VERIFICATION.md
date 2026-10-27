# NVIDIA defaults and feature verification

Verified on 26 October 2026. These are finite test results, not a guarantee for every prompt or model output.

## Changes

- Centralized text and vision defaults in `lib/models.mjs`.
- Agent templates and the end-to-end workflow now consume the shared text default instead of duplicating the model ID.
- Image reading consumes the shared NVIDIA vision default and its own compatible endpoint.
- `/api/config` exposes non-secret defaults for all model-powered features.
- Added regression coverage for eight feature defaults, six new experiment variants, eight agent templates, five guided prefixes, and saved-session preservation.
- Made the governance PDF test independent of test execution order.

| Feature | Default |
| --- | --- |
| New Explainable Chat conversations | `nvidia/Nemotron-3-Ultra-550b-a55b` |
| New Guided Generation sessions | Same Nemotron Ultra model |
| New experiment variants | Same Nemotron Ultra model |
| New Studio agent definitions | Same Nemotron Ultra model |
| Node tests, sub-agent roles, and policy evaluation | Saved agent model; new definitions default to Nemotron Ultra |
| Lumen-Agent governance assistant | Same Nemotron Ultra model |
| Image reading for chat and guided context | `nvidia/Nemotron-3.5-Super-VL` |

Ultra uses `https://api.tokenfactory.us-central1.nebius.com/v1/`. The vision model uses `https://api.tokenfactory.nebius.com/v1/`. Explicit selections and saved active sessions are preserved; changing a default does not silently rewrite existing agent configurations or drafts. Other model options remain available.

## Live verification

Tests used the published Lumen API and its existing server-side Token Factory credential. No inference key was extracted, embedded, or added to source. Studio tests used separate anonymous verification workspaces, not the owner's saved workspace.

30 live checks: **28 passed, one failed the probability-display assertion, and one completed with a documented quality/metadata limitation**. Both problematic cases used temperature 2. Most cases verify execution and response structure; their success does not establish factual accuracy.

| Feature | Variations tested | Result |
| --- | --- | --- |
| Chat and the API used by Experiments | Capital question, structured JSON, identity prompt; temperatures 0.2, 0.7, 0.8, 2; Top P 0.9, 0.95, 1 | Normal settings returned content and token alternatives. Both temperature-2 tests had unusable probability display. |
| Guided Generation | Empty prefix, selected word, custom sentence, partial tool JSON | 4/4 passed; 20 sorted alternatives each. Observed request times: 5.38–6.15 seconds. |
| Image reading | Independent red and blue PNG fixtures | 2/2 passed using NVIDIA vision; both colors correctly described. |
| Lumen-Agent | Overview/attention question and unavailable billing question | 2/2 passed. Reported supplied counts and acknowledged absent cost data. Context was explicitly synthetic. |
| Input node | Billing and account-access tasks | 2/2 execution passes; input preservation is expected behavior. |
| Agent node | Billing and account-access tasks | 2/2 execution passes; produced internal memos. |
| Tool node | Billing and account-access tasks | 2/2 execution passes; receipts explicitly identify local TypeScript functions and sample account data. |
| Sub-agent reviewer node | Billing and account-access tasks | 2/2 execution passes, with a content-quality concern below. |
| Memory node | Billing and account-access context | 2/2 execution passes; memory remains scoped to the run. |
| Output node | Billing and account-access context | 2/2 execution passes; returned preceding context. |
| Full saved graph | Duplicate-charge case and account-access case | 2/2 passed; six nodes each; observed durations 13.56 and 14.76 seconds. |
| Studio → Governance persistence | Both independent verification workspaces | All 14 Studio run IDs were found in Governance after execution. |

Recorded timing includes network/orchestration overhead and is not a provider benchmark or SLA. Existing live inference paths were tested against published version 58 before publishing the centralized defaults; model IDs and inference behavior did not change in this update.

### Temperature 2 finding

The first temperature-2 request returned HTTP 200 but no usable aligned token probabilities. A follow-up with `Hi, who are you? Answer in one sentence.`, temperature 2, Top P 0.95, and a 2,048-token budget produced incoherent multilingual output, reached `finishReason: length`, consumed all 2,048 output tokens, and had zero usable aligned probability positions. The application displayed its missing-alternatives warning.

With the same prompt, temperature 0.2 and 0.8 returned coherent single-sentence answers and 14/17 displayed token positions respectively. These observations support avoiding temperature 2 for this workflow. They do not establish whether the missing probabilities originated in provider metadata or local token-to-answer alignment; that requires inspecting the raw provider response. No temperature range was changed by this update.

### Content-quality finding

An isolated billing reviewer response asserted that a local account record showed no matching posted payments, although the test input contained no ledger evidence. The node executed successfully, but that claim was unsupported. Execution success must not be presented as factual correctness; generated memos still require evidence checks and review.

## Automated verification

**27 JavaScript suites passed**, with deterministic provider fixtures where applicable. Coverage includes:

- NVIDIA defaults, ordinary chat parameter variations, comparison-pane independence, experiments, cancellation, usage, cost estimates, and token differences.
- Guided history, custom insertions, undo/redo, autoplay, end tokens, response normalization, sorted alternatives, and invalid provider metadata.
- Image input validation, context construction, cancellation, access/rate-limit failures, malformed responses, and secret-safe errors.
- Agent/node execution, graph validation, retries, global/local policies, allow/flag/block/approval outcomes, and incomplete execution.
- Governance storage, workspace isolation, CSRF, concurrent edits, exact Studio configuration synchronization, node/edge changes, historical data separation, and audit records.
- Connector-key scope/revocation, authenticated telemetry ingestion, duplicate/out-of-order traces, signed evidence, tamper detection, and PDF export.
- Governance assistant scope, bounded context, redaction, missing data, and response handling.

TypeScript checking, production build, and Git whitespace checks passed. The governance PDF fixture produced a five-page PDF with an attached signed evidence bundle.

## Verification limits

- Browser visual/interaction QA was unavailable because the managed preview daemon was absent. API and source tests do not verify every click, hover position, or mobile layout.
- The optional Python CrewAI/LangGraph connector suite could not run: `langchain_core` and framework dependencies were not installed. JavaScript ingestion tests passed; this does not verify a real external framework/MCP deployment.
- Approval decisions are recorded but do not resume held runs. Persistent cross-run/vector memory and real external CRM actions remain unconnected.
- Chat currently uses a non-streaming JSON completion endpoint. Agent execution streams run events; this is distinct from token-by-token chat streaming.
- Tables, filters, policies, assignments, evidence exports, and permission cases were tested through automated source/service suites, not a fresh browser walkthrough.
- This exercise verified the configured NVIDIA defaults, not every alternative DeepSeek/Qwen model in the catalog.

## Reproduce local checks

Install the locked JavaScript dependencies first, then run:

```bash
node tests/nvidia-defaults.mjs
node tests/experiment-chat-route.mjs
node tests/agent-execution.mjs
node tests/end-to-end-demo.mjs
node tests/governance-server.mjs
node tests/governance-pdf.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
pnpm build
```

Live reproduction requires a configured server-side `NEBIUS_API_KEY` and incurs provider usage. Never put it in the browser or source repository.
