# Lumen agent telemetry

This package connects **your running Python agents** to Lumen's server-backed Governance workspace. It does not execute agents on Lumen, add a Python runtime to the Site, or activate an MCP URL saved in the Studio catalog.

## Connect

1. Open Agent Studio → Connect (or Governance → Connections). Select the saved agent. Create a named key with an expiry. Copy it once.
2. Install this package: `pip install -e .`. Install the applicable optional dependencies: `pip install -e '.[langgraph]'`, `'.[crewai]'` or `'.[mcp]'`.
3. Set `LUMEN_ENDPOINT` to the exact HTTPS `/api/telemetry/v1/traces` URL shown in the UI, `LUMEN_AGENT_ID` to the selected saved agent ID, and `LUMEN_API_KEY` to its new connector key. This is **not** your Nebius key.
4. Use the framework code shown in the UI. Call `client.flush()` at shutdown; failures retain telemetry in `.lumen-outbox.sqlite3`. Restore connectivity and retry the flush with the same key. Do not rerun an agent just to resend telemetry.
5. Open Governance → Runs & performance → Live executions. The trace ID links the root, child agents, model calls, and tools. Connector health shows the last authenticated batch received.

### Sites service access

Some Sites hosting/access policies also require a platform service credential for automated callers (including HTTP 403 / edge error 1010). Ask the Site owner to obtain its **Sites service-access credential** through the Sites integration, then set `LUMEN_SITE_SERVICE_TOKEN` in the trusted agent backend. The adapter sends it only to the configured Site as `OAI-Sites-Authorization: Bearer ...`; the separate agent-scoped `LUMEN_API_KEY` is still required. Neither credential is written to the outbox. Redirects are refused. Do not expose the platform credential in browser code, shared notebooks, or source control. This grants platform access, not access to other users' application records. The release's hosted API checks used this supported access path.

The outbox uses durable SQLite, a background sender, timeouts, and bounded retries. The collector deduplicates span IDs, accepts children arriving before parents, and prevents completed spans from being overwritten. Callbacks record metadata and explicit concise summaries; raw prompts, completions, tool arguments, credentials, and hidden reasoning are not captured automatically. Protect the outbox file like other operational data. Use a separate outbox per process in high-volume deployments.

## Frameworks

**LangGraph:** pass `LumenCallbackHandler(client)` in `config={"callbacks": [handler]}` to `graph.invoke` or `graph.ainvoke`. Native chain, model, and tool callbacks preserve parent relationships. Token counts are included when the provider supplies usage. Costs remain unavailable unless a custom span supplies explicit pricing-derived cost.

**CrewAI:** keep `with LumenCrewObserver(client, crew):` around `crew.kickoff(...)`. The observer uses native task and tool events and restricts them to that Crew's task IDs. Use a distinct observer for every concurrent Crew invocation. The adapter does not parse verbose reasoning logs. Unsupported/unmatched events are not attributed to unrelated agents.

**Custom tools:** `with client.trace('Workflow') as run:`, then `with run.span('lookup', operation='execute_tool', tool='lookup') as step:` around the actual function. Use `step.summary('Retrieved the permitted account fields')` for a deliberate sanitized summary. Exceptions are marked failed and re-raised.

**MCP:** establish an authenticated `mcp.ClientSession` in your own trusted backend, using an allowlisted MCP endpoint and backend secrets. Call `await observed_call_tool(run, session, 'tool_name', arguments)`. This performs the real session call, preserves its result/error, and records a span. The Lumen key authorizes telemetry ingestion only; it is not an MCP credential. Lumen never fetches arbitrary connector URLs or receives MCP server secrets.

## OTLP boundary

POST `/api/telemetry/v1/traces` with `Authorization: Bearer <connector key>` and `Content-Type: application/json`. This collector accepts OTLP/HTTP **JSON traces**, not protobuf, gRPC, metrics, or logs. Standard protobuf exporters require an OTLP collector/JSON bridge or this adapter. JSON uses `resourceSpans → scopeSpans → spans`, hexadecimal trace/span IDs, and decimal-string nanosecond timestamps.

Supported attributes: `lumen.agent.id`, `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.tool.name`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `lumen.cost.usd`, `lumen.summary`, `lumen.input.summary`, `lumen.output.summary`, and `lumen.policy.{rule,action,severity,violated}`. Unknown attributes are discarded. Declare externally enforced blocks/holds with `lumen.status` = `Blocked` / `Awaiting approval`. Reported policy events are observations, not proof of server-side enforcement. Approval/resume must be implemented in the external runtime.

Limits: 256 KB request, 100 spans per batch, 500 spans per trace; 20 active keys per private workspace. Requests outside key agent scope, with expired/revoked keys, malformed IDs, conflicting replays, cycles, or excessive timestamps are rejected. A failed batch leaves no partial trace update.

## Evidence and trust

Governance → Evidence & exports downloads PDF and JSON from a consistent server snapshot. PDFs embed the complete JSON. To verify offline: `pip install cryptography rfc8785`, then `python verify_evidence.py lumen-evidence.json --fingerprint <previously trusted SHA-256>`.

Every server mutation appends a SHA-256 audit link. An ECDSA P-256 checkpoint signs the audit head and exported records digest. Keys are server-only; connector keys are stored hashed. This detects altered exports and database edits that bypass the ledger. It is not immutable storage: a privileged database operator could replace the ledger and signing key. Pin the public-key fingerprint separately. An authentic export does not prove an external agent's claims are true.

Public Site visitors have isolated private workspaces via an HttpOnly cookie; signed-in visitors use their platform identity. Keep the same browser/account to see the same workspace. Role samples are illustrative; this release does not provision real multi-user organizations or grant SMEs authenticated invitations.

Sources: [CrewAI events](https://docs.crewai.com/en/concepts/event-listener), [LangChain callbacks](https://reference.langchain.com/python/langchain-core/callbacks/base/BaseCallbackHandler), [OTLP JSON](https://opentelemetry.io/docs/specs/otlp/), [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk).
