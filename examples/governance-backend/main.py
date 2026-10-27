"""In-memory FastAPI demonstration. Not a production authorization or policy engine."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Annotated, Literal
from uuid import uuid4
from urllib.parse import urlparse
import json
import os
import hashlib
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator

app = FastAPI(title="Lumen Governance · Dummy API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("FRONTEND_ORIGINS", "http://localhost:5173,http://terminal.local:4173").split(","), allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
state = json.loads(Path(__file__).with_name("seed.json").read_text())
state_lock = RLock()
# Keep fixture times fresh while preserving their relative ordering.
shift = datetime.now(timezone.utc) - datetime.fromisoformat(state["updatedAt"].replace("Z", "+00:00"))
for collection in ["agents", "runs", "toolCalls", "policies", "approvals", "assignments", "audit", "connectors", "definitions"]:
    for item in state.get(collection, []):
        for key in ["at", "expiresAt", "lastActive", "lastCheck", "decisionAt", "updatedAt"]:
            if item.get(key):
                item[key] = (datetime.fromisoformat(item[key].replace("Z", "+00:00")) + shift).isoformat()

def now():
    return datetime.now(timezone.utc).isoformat()

def actor():
    # Fixed server-side demo identity. Replace with verified session/OIDC dependency.
    return next(u for u in state["users"] if u["id"] == os.getenv("DEMO_USER_ID", "u-owner"))

def can_access(user, agent_id):
    return user["role"] == "Owner" or agent_id in user["agentIds"]

def manager():
    user = actor()
    if user["role"] not in ["Owner", "Admin"]:
        raise HTTPException(403, "Owner or admin access required")
    return user

def audit(action, target, outcome, agent_id=None, actor_id=None):
    state["audit"].insert(0, dict(id=f"AU-{uuid4()}", actorId=actor_id or actor()["id"], action=action, target=target, outcome=outcome, at=now(), agentId=agent_id))

def expire_approvals():
    """Expiry is enforced even when a client pauses its simulated live feed."""
    current = datetime.now(timezone.utc)
    for item in state["approvals"]:
        if item["status"] == "Pending" and datetime.fromisoformat(item["expiresAt"].replace("Z", "+00:00")) <= current:
            item["status"] = "Expired"
            audit("Approval expired", item["id"], "No action executed", item["agentId"], "system")

def record(collection, item_id):
    item = next((x for x in state[collection] if x["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Record not found")
    if item.get("agentId") and not can_access(actor(), item["agentId"]):
        raise HTTPException(403, "Agent outside assigned scope")
    return item

def review(item_id):
    collection = "approvals" if item_id.startswith("APR-") else "policies"
    item = record(collection, item_id)
    user = actor()
    if user["role"] not in ["Owner", "Admin"] and item["assigneeId"] != user["id"]:
        raise HTTPException(403, "Review not delegated to current user")
    return item

class Decision(BaseModel):
    decision: Literal["Approved", "Rejected", "Changes requested"]
    note: str = Field(min_length=1, max_length=1000)

class Assignment(BaseModel):
    assigneeId: str
    note: str = Field(default="Domain review delegated", max_length=1000)

class Note(BaseModel):
    note: str = Field(min_length=1, max_length=1000)

class ConnectorDraft(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: Literal["MCP", "Custom"]
    framework: str
    endpoint: str

class AgentStatus(BaseModel):
    status: Literal["Active", "Paused", "Degraded"]

class Availability(BaseModel):
    available: bool

# A complete configuration is validated before either shared record changes.
# These demo schemas intentionally expose no credential or secret fields.
class ConfigurationModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)

class AgentProfile(ConfigurationModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=2000)
    framework: Literal["CrewAI", "LangGraph", "Custom"]
    environment: Literal["Production", "Staging"]
    status: Literal["Active", "Paused", "Degraded"]
    risk: Literal["Low", "Medium", "High", "Critical"]
    connectorId: str = Field(min_length=1, max_length=200)
    reviewerIds: list[str] = Field(max_length=20)
    tools: list[str] = Field(min_length=1, max_length=5)

DEFAULT_AGENT_BASE_URL = "https://api.tokenfactory.us-central1.nebius.com/v1/"
NEBIUS_BASE_URLS = {
    DEFAULT_AGENT_BASE_URL,
    "https://api.tokenfactory.us-north1.nebius.com/v1/",
    "https://api.tokenfactory.nebius.com/v1/",
}
LEGACY_MODEL_BASE_URLS = {
    "nvidia/Nemotron-3-Ultra-550b-a55b": DEFAULT_AGENT_BASE_URL,
    "deepseek-ai/DeepSeek-V4.1-Flash": "https://api.tokenfactory.us-north1.nebius.com/v1/",
    "deepseek-ai/DeepSeek-V4-Pro": "https://api.tokenfactory.nebius.com/v1/",
    "Qwen/Qwen3-235B-A22B-Instruct-2507": DEFAULT_AGENT_BASE_URL,
}

def model_base_url(model_id):
    """Legacy configuration fallback; an explicit endpoint is never replaced."""
    return LEGACY_MODEL_BASE_URLS.get(model_id, DEFAULT_AGENT_BASE_URL) if isinstance(model_id, str) else DEFAULT_AGENT_BASE_URL

def normalize_nebius_base_url(value):
    # Exact equality after benign formatting normalization, not a hostname
    # suffix check or general URL parser: no userinfo, ports, query or paths.
    if not isinstance(value, str):
        raise ValueError("Choose an approved Nebius API base URL")
    canonical = value.strip().rstrip("/") + "/"
    if canonical not in NEBIUS_BASE_URLS:
        raise ValueError("Choose an approved Nebius API base URL")
    return canonical

def validate_model_id(value):
    if not isinstance(value, str) or "://" in value or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}", value):
        raise ValueError("Enter a model ID, such as vendor/model or vendor/model:adapter")
    return value

class ModelSettings(ConfigurationModel):
    provider: Literal["Nebius"]
    name: str = Field(min_length=1, max_length=200)
    baseUrl: str = Field(default=DEFAULT_AGENT_BASE_URL, max_length=200)
    temperature: float = Field(ge=0, le=2)
    maxTokens: int = Field(ge=1, le=32768)

    @model_validator(mode="before")
    @classmethod
    def legacy_endpoint(cls, value):
        if isinstance(value, dict) and "baseUrl" not in value:
            return {**value, "baseUrl": model_base_url(value.get("name"))}
        return value

    @field_validator("name")
    @classmethod
    def model_id(cls, value):
        return validate_model_id(value)

    @field_validator("baseUrl")
    @classmethod
    def api_endpoint(cls, value):
        return normalize_nebius_base_url(value)

class PromptSettings(ConfigurationModel):
    system: str = Field(min_length=1, max_length=16000)
    goal: str = Field(min_length=1, max_length=4000)
    outputFormat: str = Field(min_length=1, max_length=4000)

class MemorySettings(ConfigurationModel):
    enabled: bool
    strategy: Literal["Session", "Rolling summary", "Vector store"]
    scope: Literal["Run", "Agent", "Workspace"]
    retentionDays: int = Field(ge=0, le=365)
    maxItems: int = Field(ge=1, le=10000)
    redactPII: bool

class RuntimeLimits(ConfigurationModel):
    maxSteps: int = Field(ge=1, le=1000)
    timeoutSeconds: int = Field(ge=1, le=3600)
    retries: int = Field(ge=0, le=10)
    budgetUsd: float = Field(ge=0.001, le=1000)
    requireApproval: bool

class AgentNode(ConfigurationModel):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=100)
    kind: Literal["Input", "Agent", "Sub-agent", "Tool", "Guardrail", "Memory", "Output"]
    description: str = Field(max_length=2000)
    prompt: str = Field(max_length=8000)
    enabled: bool
    toolName: str | None = None
    referencedAgentId: str | None = None

class AgentEdge(ConfigurationModel):
    id: str = Field(min_length=1, max_length=100)
    source: str
    target: str
    label: str = Field(max_length=200)

class Guardrail(ConfigurationModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(max_length=2000)
    enabled: bool
    action: Literal["Block", "Require approval", "Flag"]
    severity: Literal["Low", "Medium", "High", "Critical"]
    stage: Literal["Input", "Tool", "Output"]

def create_default_global_policies(at=None, owner_id="u-owner"):
    """Matches the frontend policy defaults; this sample records, not executes."""
    return dict(revision=1, updatedAt=at or now(), updatedBy=owner_id, rules=[
        dict(id="protect-credentials", name="Protect credentials", description="Block attempts to reveal, extract, or expose passwords, API keys, access tokens, or other credentials. Allow general safety guidance and discussion about credential handling that does not disclose secrets.", enabled=True, action="Block", severity="High", stage="Input"),
        dict(id="tenant-isolation", name="Tenant isolation", description="Block accessing or returning another tenant's data beyond the assigned tenant scope. Read-only lookups confined to the assigned tenant are allowed.", enabled=True, action="Block", severity="High", stage="Tool"),
        dict(id="review-external-actions", name="Review external actions", description="Require approval only before actually sending messages, changing external records, making payments, or performing destructive external actions. Read-only lookups, drafts, and internal summaries do not require approval.", enabled=True, action="Require approval", severity="High", stage="Tool"),
    ])

def with_global_policy_defaults(snapshot):
    """Missing-field migration only; keep explicit empty/custom bundles intact."""
    if "globalPolicies" in snapshot:
        return snapshot
    try:
        datetime.fromisoformat(snapshot.get("updatedAt", "").replace("Z", "+00:00"))
        at = snapshot["updatedAt"]
    except (ValueError, TypeError, AttributeError):
        at = now()
    owner_id = next((user["id"] for user in snapshot.get("users", []) if user.get("role") == "Owner"), "u-owner")
    return {**snapshot, "globalPolicies": create_default_global_policies(at, owner_id)}

# The seed may predate global policies. Initialize only a genuinely missing
# bundle; an owner-saved empty rule list is an intentional configuration.
state = with_global_policy_defaults(state)

class GlobalPolicyDraft(ConfigurationModel):
    expectedRevision: int = Field(ge=1)
    rules: list[Guardrail] = Field(max_length=30)

    @model_validator(mode="after")
    def unique_rules(self):
        if any(not rule.id.strip() or not rule.name.strip() for rule in self.rules):
            raise ValueError("Global policy IDs and names are required")
        if len({rule.id.strip() for rule in self.rules}) != len(self.rules):
            raise ValueError("Global policy IDs must be unique")
        if len({rule.name.strip().lower() for rule in self.rules}) != len(self.rules):
            raise ValueError("Global policy names must be unique")
        return self

class AgentDefinitionDraft(ConfigurationModel):
    model: ModelSettings
    prompt: PromptSettings
    memory: MemorySettings
    limits: RuntimeLimits
    nodes: list[AgentNode] = Field(min_length=3, max_length=40)
    edges: list[AgentEdge] = Field(max_length=100)
    guardrails: list[Guardrail] = Field(max_length=30)

class AgentConfiguration(ConfigurationModel):
    agent: AgentProfile
    definition: AgentDefinitionDraft
    expectedRevision: int = Field(ge=1)

# Receipts only: the hosted Worker executes model calls. This endpoint records
# their bounded, terminal result and never invokes models or external tools.
ExecutionText = Annotated[str, Field(max_length=262144)]
ExecutionId = Annotated[str, Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_.:-]+$")]

class TokenUsage(ConfigurationModel):
    generation: int = Field(ge=0, le=100000000)
    policy: int = Field(ge=0, le=100000000)

class ExecutedPolicyCheck(ConfigurationModel):
    id: str = Field(min_length=1, max_length=200)
    rule: str = Field(min_length=1, max_length=200)
    stage: Literal["Input", "Tool", "Output"]
    action: Literal["Block", "Require approval", "Flag"]
    violated: bool
    summary: str = Field(max_length=1000)

class ExecutedNode(ConfigurationModel):
    nodeId: ExecutionId
    label: str = Field(min_length=1, max_length=200)
    kind: Literal["Input", "Agent", "Sub-agent", "Tool", "Guardrail", "Memory", "Output"]
    status: Literal["Success", "Failed", "Blocked", "Awaiting approval", "Cancelled", "Skipped"]
    input: ExecutionText
    output: ExecutionText
    summary: str = Field(max_length=8000)
    at: str = Field(max_length=80)
    duration: float = Field(ge=0, le=86400000)
    tokens: int = Field(ge=0, le=100000000)
    tokenUsage: TokenUsage | None = None
    policyChecks: list[ExecutedPolicyCheck] | None = Field(default=None, max_length=100)
    cost: float = Field(ge=0, le=1000000)
    toolName: str | None = Field(default=None, max_length=100)
    toolMode: Literal["demo"] | None = None
    model: str | None = Field(default=None, max_length=200)
    baseUrl: str | None = Field(default=None, max_length=200)

    @field_validator("model")
    @classmethod
    def model_id(cls, value):
        return None if value is None else validate_model_id(value)

    @field_validator("baseUrl")
    @classmethod
    def api_endpoint(cls, value):
        return normalize_nebius_base_url(value)

    @field_validator("at")
    @classmethod
    def valid_time(cls, value):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Execution timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_token_usage(self):
        if self.tokenUsage is not None and self.tokenUsage.generation + self.tokenUsage.policy != self.tokens:
            raise ValueError("Node generation and policy token usage must sum to tokens")
        return self

class ExecutedPolicy(ConfigurationModel):
    rule: str = Field(min_length=1, max_length=200)
    severity: Literal["Low", "Medium", "High", "Critical"]
    action: Literal["Block", "Require approval", "Flag"]
    context: str = Field(max_length=16000)
    nodeId: ExecutionId | None = None

class AgentExecution(ConfigurationModel):
    id: ExecutionId
    agentId: ExecutionId
    configurationRevision: int = Field(ge=1)
    globalPolicyRevision: int | None = Field(default=None, ge=1)
    mode: Literal["agent", "node"]
    nodeId: ExecutionId | None = None
    input: str = Field(max_length=16000)
    output: ExecutionText
    status: Literal["Success", "Failed", "Blocked", "Awaiting approval", "Cancelled"]
    at: str = Field(max_length=80)
    duration: float = Field(ge=0, le=86400000)
    tokens: int = Field(ge=0, le=100000000)
    tokenUsage: TokenUsage | None = None
    cost: float = Field(ge=0, le=1000000)
    costKnown: bool
    model: str = Field(min_length=1, max_length=200)
    baseUrl: str | None = Field(default=None, max_length=200)
    nodes: list[ExecutedNode] = Field(max_length=200)
    policies: list[ExecutedPolicy] = Field(max_length=100)
    warnings: list[Annotated[str, Field(max_length=4000)]] = Field(max_length=100)

    @field_validator("globalPolicyRevision")
    @classmethod
    def global_policy_revision(cls, value):
        if value is None:
            raise ValueError("Global policy revision must be a positive integer when supplied")
        return value

    @field_validator("model")
    @classmethod
    def model_id(cls, value):
        return validate_model_id(value)

    @field_validator("baseUrl")
    @classmethod
    def api_endpoint(cls, value):
        return normalize_nebius_base_url(value)

    @field_validator("at")
    @classmethod
    def valid_time(cls, value):
        return ExecutedNode.valid_time(value)

    @model_validator(mode="after")
    def validate_receipt(self):
        if self.tokenUsage is not None and self.tokenUsage.generation + self.tokenUsage.policy != self.tokens:
            raise ValueError("Execution generation and policy token usage must sum to tokens")
        if len({n.nodeId for n in self.nodes}) != len(self.nodes):
            raise ValueError("Node execution IDs must be unique")
        if self.mode == "node" and (not self.nodeId or any(n.nodeId != self.nodeId for n in self.nodes)):
            raise ValueError("A node test must identify its tested node")
        if self.mode == "agent" and self.nodeId is not None:
            raise ValueError("Full-agent runs do not have a test node ID")
        for node in self.nodes:
            if node.kind == "Tool" and node.status != "Skipped" and (node.toolMode != "demo" or node.toolName not in TOOL_NAMES):
                raise ValueError("Only labeled demo tool receipts are supported")
        if len(self.model_dump_json()) > 8_000_000:
            raise ValueError("Execution receipt exceeds the storage limit")
        return self

TOOL_NAMES = {"web_search", "crm_lookup", "database_query", "email_draft", "ticket_create"}

def validate_configuration(agent_id, body, user):
    def require(condition, message):
        if not condition:
            raise HTTPException(422, message)
    profile, definition = body.agent, body.definition
    for label, value in [("Agent name", profile.name), ("Description", profile.description), ("Model provider", definition.model.provider), ("Model name", definition.model.name), ("System prompt", definition.prompt.system), ("Goal", definition.prompt.goal), ("Output format", definition.prompt.outputFormat)]:
        require(bool(value.strip()), f"{label} is required")
    require(len(set(profile.tools)) == len(profile.tools) and set(profile.tools) <= TOOL_NAMES, "Choose unique tools from the available catalog")
    linked_connectors = {a["connectorId"] for a in state["agents"] if can_access(user, a["id"])}
    allowed_connectors = {c["id"] for c in state["connectors"] if user["role"] == "Owner" or c["id"] in linked_connectors or c.get("createdById") == user["id"]}
    require(profile.connectorId in allowed_connectors, "Choose an available connector in your scope")
    require(len(set(profile.reviewerIds)) == len(profile.reviewerIds), "Reviewers must be unique")
    users = {u["id"]: u for u in state["users"]}
    for reviewer_id in profile.reviewerIds:
        require(reviewer_id in users and can_access(users[reviewer_id], agent_id), "Reviewers must be assigned to this agent")
    nodes = {n.id: n for n in definition.nodes}
    require(len(nodes) == len(definition.nodes), "Graph node IDs must be unique")
    require(len({e.id for e in definition.edges}) == len(definition.edges), "Graph edge IDs must be unique")
    require(len({(e.source, e.target) for e in definition.edges}) == len(definition.edges), "A graph connection cannot be duplicated")
    require(len({g.id for g in definition.guardrails}) == len(definition.guardrails), "Guardrail IDs must be unique")
    require(len({g.name.strip().lower() for g in definition.guardrails}) == len(definition.guardrails), "Guardrail names must be unique")
    for guardrail in definition.guardrails:
        require(bool(guardrail.id.strip()) and bool(guardrail.name.strip()), "Guardrail ID and name are required")
    agents = {a["id"]: a for a in state["agents"]}
    for node in definition.nodes:
        require(bool(node.id.strip()) and bool(node.label.strip()), "Each graph node needs an ID and label")
        if node.kind == "Tool" and node.enabled:
            require(node.toolName in profile.tools, "Tool nodes must reference an enabled agent tool")
        if node.referencedAgentId:
            require(node.referencedAgentId in agents and node.referencedAgentId != agent_id and can_access(user, node.referencedAgentId), "Referenced agent is unavailable or outside your scope")
    adjacency = {node_id: [] for node_id in nodes}
    indegree = {node_id: 0 for node_id in nodes}
    for edge in definition.edges:
        require(bool(edge.id.strip()), "Each graph connection needs an ID")
        require(edge.source in nodes and edge.target in nodes and edge.source != edge.target, "Graph edges must connect two existing distinct nodes")
        adjacency[edge.source].append(edge.target)
        indegree[edge.target] += 1
    queue = [node_id for node_id, degree in indegree.items() if degree == 0]
    visited = 0
    while queue:
        node_id = queue.pop()
        visited += 1
        for target in adjacency[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    require(visited == len(nodes), "Workflow graph must be acyclic")
    inputs = [n.id for n in definition.nodes if n.kind == "Input" and n.enabled]
    outputs = [n.id for n in definition.nodes if n.kind == "Output" and n.enabled]
    primary = any(n.kind == "Agent" and n.enabled for n in definition.nodes)
    require(bool(inputs) and bool(outputs) and primary, "Keep an enabled input, primary agent, and output node")
    reachable = set(inputs)
    queue = list(inputs)
    while queue:
        for target in adjacency[queue.pop()]:
            if target not in reachable:
                reachable.add(target)
                queue.append(target)
    require(all(output in reachable for output in outputs), "Every enabled output must be reachable from an input")
    require(all(n.id in reachable for n in definition.nodes if n.enabled), "Connect every enabled node to an input, or disable unused nodes")

def connector_check(draft):
    if not draft.name.strip():
        raise HTTPException(422, "Enter a connector name")
    url = urlparse(draft.endpoint)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise HTTPException(422, "Use an HTTPS placeholder without credentials or query parameters")

ENDPOINTS = {"agents":"agents", "agent-definitions":"definitions", "runs":"runs", "tool-calls":"toolCalls", "policy-events":"policies", "approvals":"approvals", "users":"users", "assignments":"assignments", "audit-events":"audit", "connectors":"connectors"}

def visible(key):
    expire_approvals()
    user = actor()
    def permitted(item):
        return not item.get("agentId") or can_access(user, item["agentId"])
    values = deepcopy(state.get(key, []))
    if key == "definitions":
        # Upgrade only the returned copy. Historical receipts and stored custom
        # model settings must not be rewritten by a read request.
        for item in values:
            settings = item.get("model")
            if isinstance(settings, dict) and "baseUrl" not in settings:
                settings["baseUrl"] = model_base_url(settings.get("name"))
    if key == "agents":
        return [x for x in values if can_access(user, x["id"])]
    if key == "users":
        # Current server-side identity first; the UI disables role switching in API mode.
        return sorted(values, key=lambda x: x["id"] != user["id"])
    if key == "connectors":
        if user["role"] not in ["Owner", "Admin"]:
            return []
        allowed = {a["connectorId"] for a in state["agents"] if can_access(user, a["id"])}
        return [x for x in values if user["role"] == "Owner" or x["id"] in allowed or x.get("createdById") == user["id"]]
    if key in ["approvals", "policies"]:
        return [x for x in values if permitted(x) and (user["role"] in ["Owner", "Admin"] or x["assigneeId"] == user["id"])]
    review_ids = {x["id"] for x in visible("approvals") + visible("policies")} if key in ["assignments", "audit"] else set()
    if key == "assignments":
        return [x for x in values if x["reviewId"] in review_ids]
    if key == "audit":
        return [x for x in values if user["role"] == "Owner" or (user["role"] == "Admin" and x["actorId"] == user["id"]) or (x.get("agentId") and permitted(x) and (user["role"] == "Admin" or x["target"] in review_ids))]
    return [x for x in values if permitted(x)]

# Explicit route factory prevents GET /api/connectors from swallowing /test.
for route, collection in ENDPOINTS.items():
    def make_list(key):
        async def list_records():
            return visible(key)
        return list_records
    app.add_api_route(f"/api/{route}", make_list(collection), methods=["GET"], name=f"list_{route}")

@app.get("/api/global-policies")
def global_policies():
    # Global rule definitions are visible to all roles in this demo workspace.
    # This endpoint exposes no additional agents, receipts, or review records.
    actor()
    with state_lock:
        return deepcopy(state["globalPolicies"])

@app.post("/api/global-policies")
def save_global_policies(body: GlobalPolicyDraft):
    with state_lock:
        user = actor()
        if user["role"] != "Owner":
            raise HTTPException(403, "Only the workspace owner can change global policies")
        current = state["globalPolicies"]
        if body.expectedRevision != current["revision"]:
            raise HTTPException(409, "Global policies changed since this draft was opened. Reload before saving.")
        rules = [rule.model_dump() for rule in body.rules]
        for rule in rules:
            rule["id"] = rule["id"].strip()
            rule["name"] = rule["name"].strip()
        updated = now()
        bundle = dict(revision=current["revision"] + 1, updatedAt=updated, updatedBy=user["id"], rules=rules)
        state["globalPolicies"] = bundle
        state["updatedAt"] = updated
        audit("Global policies saved", "global-policies", f"Revision {bundle['revision']} · {len(rules)} rules · configuration only", actor_id=user["id"])
        return {"ok": True, "mock": True, "executed": False, "revision": bundle["revision"]}

@app.post("/api/approvals/{item_id}/decision")
def decide(item_id: str, body: Decision):
    item = review(item_id)
    expire_approvals()
    if not item_id.startswith("APR-") or item["status"] != "Pending":
        raise HTTPException(409, "Approval is no longer pending")
    if not body.note.strip():
        raise HTTPException(422, "Add a review note")
    item.update(status=body.decision, note=body.note.strip(), decisionAt=now())
    audit(f"Approval {body.decision.lower()}", item_id, body.note, item["agentId"])
    return {"ok": True, "mock": True, "executed": False}

@app.post("/api/reviews/{item_id}/assign")
def assign(item_id: str, body: Assignment):
    manager()
    item = review(item_id)
    expire_approvals()
    if item["status"] not in ["Pending", "Open", "In review"]:
        raise HTTPException(409, "Completed review cannot be reassigned")
    target = next((x for x in state["users"] if x["id"] == body.assigneeId), None)
    if not target or not target["available"] or not can_access(target, item["agentId"]):
        raise HTTPException(422, "Reviewer must be available and assigned to this agent")
    if item["assigneeId"] == target["id"]:
        raise HTTPException(409, "Reviewer already assigned")
    state["assignments"].insert(0, dict(id=f"AS-{uuid4()}", reviewId=item_id, fromId=item["assigneeId"], toId=target["id"], actorId=actor()["id"], at=now(), note=body.note))
    item["assigneeId"] = target["id"]
    if "disposition" in item:
        item["status"] = "In review"
    audit("Review assigned", item_id, f"Assigned to {target['name']}", item["agentId"])
    return {"ok": True, "mock": True}

@app.post("/api/policy-events/{item_id}/resolve")
def resolve(item_id: str, body: Note):
    item = review(item_id)
    if "disposition" not in item or item["status"] == "Resolved":
        raise HTTPException(409, "Policy event already resolved")
    if not body.note.strip():
        raise HTTPException(422, "Add remediation notes")
    item.update(status="Resolved", notes=body.note.strip())
    audit("Policy review resolved", item_id, body.note, item["agentId"])
    return {"ok": True, "mock": True}

@app.post("/api/connectors/test")
def test_connector(body: ConnectorDraft):
    manager()
    connector_check(body)
    ok = "fail" not in body.endpoint
    return {"ok": ok, "message": "Mock test passed. No endpoint was contacted." if ok else "Simulated health check failed."}

@app.post("/api/connectors")
def save_connector(body: ConnectorDraft):
    user = manager()
    connector_check(body)
    item = dict(**{**body.model_dump(), "name": body.name.strip()}, id=f"c-{uuid4()}", createdById=user["id"], agentId=None, status="Not tested", lastCheck=now(), tools=["web_search", "ticket_create"])
    state["connectors"].append(item)
    audit("Demo connector saved", item["id"], "Configuration only · not connected")
    return item

@app.post("/api/agents/{item_id}/status")
def agent_status(item_id: str, body: AgentStatus):
    with state_lock:
        user = manager()
        item = record("agents", item_id)
        if not can_access(user, item_id):
            raise HTTPException(403, "Agent outside assigned scope")
        item["status"] = body.status
        definition = next((d for d in state.get("definitions", []) if d["agentId"] == item_id), None)
        if definition:
            definition.update(revision=definition["revision"] + 1, updatedAt=now(), updatedBy=user["id"])
        audit("Agent status changed", item_id, body.status, item_id)
    return {"ok": True, "mock": True}

@app.post("/api/agents/{item_id}/configuration")
def save_agent_configuration(item_id: str, body: AgentConfiguration):
    with state_lock:
        user = manager()
        item = record("agents", item_id)
        if not can_access(user, item_id):
            raise HTTPException(403, "Agent outside assigned scope")
        definition = next((d for d in state.get("definitions", []) if d["agentId"] == item_id), None)
        if definition is None:
            raise HTTPException(409, "Agent definition unavailable; refresh the shared demo fixture")
        if body.expectedRevision != definition["revision"]:
            raise HTTPException(409, "Configuration changed since this draft was opened. Reload before saving.")
        validate_configuration(item_id, body, user)
        next_profile = body.agent.model_dump()
        next_profile["name"] = next_profile["name"].strip()
        next_profile["description"] = next_profile["description"].strip()
        next_definition = body.definition.model_dump(exclude_none=True)
        for guardrail in next_definition["guardrails"]:
            guardrail["name"] = guardrail["name"].strip()
        next_definition.update(agentId=item_id, revision=definition["revision"] + 1, updatedAt=now(), updatedBy=user["id"])
        next_profile["policies"] = [g["name"].strip() for g in next_definition["guardrails"] if g["enabled"]]
        # One transaction for the same records read by Studio and Governance.
        item.update(next_profile)
        definition.clear()
        definition.update(next_definition)
        audit("Agent configuration saved", item_id, f"Revision {definition['revision']} · demo configuration only", item_id)
        return {"ok": True, "mock": True, "executed": False, "revision": definition["revision"]}

def receipt_text(value, limit=16000):
    """Keep recorded summaries/output, never a model's tagged hidden reasoning."""
    value = re.sub(r"<(think|analysis)\b[^>]*>[\s\S]*?</\1\s*>", "", value, flags=re.IGNORECASE)
    closings = list(re.finditer(r"</(?:think|analysis)\s*>", value, flags=re.IGNORECASE))
    if closings:
        value = value[closings[-1].end():]
    value = re.sub(r"<(?:think|analysis)\b[^>]*>[\s\S]*$", "", value, flags=re.IGNORECASE)
    return value[:limit]

@app.post("/api/agent-executions")
def record_agent_execution(body: AgentExecution):
    with state_lock:
        user = manager()
        agent = record("agents", body.agentId)
        if not can_access(user, body.agentId):
            raise HTTPException(403, "Agent outside assigned scope")
        payload = body.model_dump(exclude_none=True)
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        existing = next((run for run in state["runs"] if run["id"] == body.id), None)
        if existing:
            if existing.get("source") == "live" and existing.get("executionDigest") == digest:
                return {"ok": True, "recorded": True, "duplicate": True, "executed": False}
            raise HTTPException(409, "This execution ID is already recorded with a different result")
        definition = next((d for d in state.get("definitions", []) if d["agentId"] == body.agentId), None)
        if definition is None or body.configurationRevision > definition["revision"]:
            raise HTTPException(409, "Execution references an unavailable configuration revision")
        trace_kinds = {"Tool": "Tool call", "Sub-agent": "Handoff", "Guardrail": "Policy check"}
        steps = []
        for node in body.nodes:
            step = dict(label=receipt_text(node.label, 200), kind=trace_kinds.get(node.kind, "Decision summary"), nodeKind=node.kind, summary=receipt_text(node.summary, 2000), duration=node.duration, outcome=node.status, nodeId=node.nodeId, tokens=node.tokens, input=receipt_text(node.input, 32000), output=receipt_text(node.output, 64000), **({"model": node.model} if node.model else {}))
            if node.tokenUsage is not None:
                step["tokenUsage"] = node.tokenUsage.model_dump()
            if node.baseUrl is not None:
                step["baseUrl"] = node.baseUrl
            if node.policyChecks is not None:
                step["policyChecks"] = [dict(id=check.id, rule=receipt_text(check.rule, 200), stage=check.stage, action=check.action, violated=check.violated, summary=receipt_text(check.summary, 1000)) for check in node.policyChecks]
            steps.append(step)
        run = dict(id=body.id, agentId=body.agentId, task=receipt_text(body.input, 16000) or ("Individual node test" if body.mode == "node" else "Agent execution"), status="Failed" if body.status == "Cancelled" else body.status, at=body.at, duration=body.duration, tokens=body.tokens, cost=body.cost if body.costKnown else 0, risk=agent["risk"], configurationRevision=body.configurationRevision, source="live", executionMode=body.mode, executionStatus=body.status, output=receipt_text(body.output, 120000), model=body.model, costKnown=body.costKnown, warnings=[receipt_text(warning, 4000) for warning in body.warnings], executionDigest=digest, steps=steps)
        if body.tokenUsage is not None:
            run["tokenUsage"] = body.tokenUsage.model_dump()
        if body.baseUrl is not None:
            run["baseUrl"] = body.baseUrl
        if body.globalPolicyRevision is not None:
            run["globalPolicyRevision"] = body.globalPolicyRevision
        if not run["steps"]:
            run["steps"] = [dict(label="Execution ended", kind="Decision summary", summary="No node result was recorded before execution ended.", duration=body.duration, outcome=body.status, tokens=body.tokens, **({"tokenUsage": body.tokenUsage.model_dump()} if body.tokenUsage is not None else {}))]
        if body.nodeId:
            run["nodeId"] = body.nodeId
        calls = [dict(id=f"TC-{body.id}-{index}", agentId=body.agentId, runId=body.id, nodeId=node.nodeId, name=node.toolName, at=node.at, status="Success" if node.status == "Success" else "Blocked" if node.status in ["Blocked", "Awaiting approval"] else "Failed", latency=node.duration, risk=agent["risk"], input=receipt_text(node.input, 12000), output="Demo tool · no external action. " + receipt_text(node.output, 12000), permissions=["Demo adapter only · no external permissions used"], checks=["No external connector contacted", f"Node outcome: {node.status}"]) for index, node in enumerate(body.nodes) if node.kind == "Tool" and node.status != "Skipped"]
        policies = [dict(id=f"POL-{body.id}-{index}", agentId=body.agentId, runId=body.id, rule=receipt_text(policy.rule, 200), severity=policy.severity, action=policy.action, at=body.at, status="Open", disposition="Blocked" if policy.action == "Block" else "Flagged", context=receipt_text(policy.context, 16000), notes="Recorded model policy check. Review required; no external action was executed.", assigneeId=None) for index, policy in enumerate(body.policies)]
        approvals = []
        if body.status == "Awaiting approval":
            requests = [p for p in body.policies if p.action == "Require approval"]
            if not requests:
                requests = [ExecutedPolicy(rule="Human approval gate", severity=agent["risk"], action="Require approval", context=body.output[:16000] or "Execution stopped before a sensitive action.")]
            expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
            for policy in requests[:1]:
                approvals.append(dict(id=f"APR-{body.id}", agentId=body.agentId, runId=body.id, action=receipt_text(policy.rule, 200), risk=policy.severity, context=receipt_text(policy.context, 16000), status="Pending", at=body.at, expiresAt=expires, assigneeId=None, note="Execution held for review. Approval records a decision; it does not automatically resume the run."))
        for collection, records in [("toolCalls", calls), ("policies", policies), ("approvals", approvals)]:
            existing_ids = {item["id"] for item in state[collection]}
            if any(item["id"] in existing_ids for item in records):
                raise HTTPException(409, "Execution child record ID collision")
        # Validate and construct everything before mutating shared collections.
        state["runs"].insert(0, run)
        state["toolCalls"][0:0] = calls
        state["policies"][0:0] = policies
        state["approvals"][0:0] = approvals
        if datetime.fromisoformat(body.at.replace("Z", "+00:00")) > datetime.fromisoformat(agent["lastActive"].replace("Z", "+00:00")):
            agent["lastActive"] = body.at
        state["updatedAt"] = now()
        audit("Node test recorded" if body.mode == "node" else "Agent execution recorded", body.id, f"{body.status} · revision {body.configurationRevision} · live model / demo tools", body.agentId, user["id"])
        return {"ok": True, "recorded": True, "duplicate": False, "executed": False}

@app.post("/api/users/{item_id}/availability")
def user_availability(item_id: str, body: Availability):
    user = manager()
    item = record("users", item_id)
    if item["role"] in ["Owner", "Admin"]:
        raise HTTPException(403, "Owner and admin availability is fixed in this demo")
    if user["role"] != "Owner" and not any(can_access(user, agent_id) for agent_id in item["agentIds"]):
        raise HTTPException(403, "Reviewer outside assigned agent scope")
    item["available"] = body.available
    audit("Reviewer availability changed", item_id, "Available" if body.available else "Away")
    return {"ok": True, "mock": True}
