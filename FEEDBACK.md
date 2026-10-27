# Token Factory and Nemotron feedback

Built by Arsalan for the Nebius × NVIDIA Global AI Hackathon.

## What helped

- **OpenAI-compatible requests:** one server inference boundary supports chat, experiments, and saved agent graphs. Hosted Nemotron avoided operating an inference cluster for the hackathon.
- **Log probabilities:** generated-token logprobs and ranked alternatives enabled token hover inspection and human-guided continuation. Lumen converts logprobs with `exp(logprob)` and sorts candidates by probability. Chat asks for 10 alternatives; guided generation asks for 20, while accepting shorter provider results.
- **Nemotron 3 Ultra:** `nvidia/Nemotron-3-Ultra-550b-a55b` is the default for all new generation workflows and experiment variants. Its configured endpoint is `https://api.tokenfactory.us-central1.nebius.com/v1/`. Responses and per-node receipts retain the selected model, endpoint, usage, and duration.

## Specific friction and suggestions

1. **Continuation capabilities:** assistant-prefix continuation and logprob availability vary by model. A machine-readable capabilities response documenting prefix support, top-logprob limits, and streaming compatibility would simplify model selection and error messages.
2. **Token-by-token latency:** guided generation requests one next token after each user selection; Play repeats this process. Network latency and repeated prefix processing accumulate. A resumable prediction/session API with prefix caching would improve this interaction. This is a workflow observation, not a controlled provider benchmark.
3. **Regional routing:** Nemotron uses US Central in this app; other models have different configured endpoints. Per-model endpoint discovery would reduce configuration errors. Redirects are not followed when sending credentials.
4. **Pricing metadata:** usage counters are useful, but Lumen does not have authoritative per-response pricing/billing metadata. Experiments require manually entered rates; unpriced Governance runs show cost unavailable. Versioned model pricing and optional billable-cost metadata would make comparisons more useful.
5. **Probability interpretation:** high token probability is not proof of correctness. Candidate arrays can be shorter than requested and tiny alternatives can round to zero. Explicit capability limits, token bytes, finish reasons, and stable usage fields help keep the visualization accurate.

## Measurement boundaries

- Chat/experiment duration is observed request latency, not a provider-only inference metric. Image preprocessing, orchestration, and policy calls can add latency.
- Studio records node and full-run durations. Sum of node durations may differ from total elapsed time.
- No throughput, latency SLA, accuracy score, or price advantage is claimed here.
- Built-in tools are local TypeScript functions. External MCP tools run in the user's backend; their reports are separate from Token Factory inference receipts.
- Historical samples and unverified browser imports are not Nemotron execution evidence. Governance excludes them from live metrics by default.
