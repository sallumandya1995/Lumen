"""Dummy framework-agnostic agent node using the official MCP Python SDK v2."""
from mcp.server import MCPServer

mcp = MCPServer("Governance demo agent")

@mcp.tool()
def agent_status() -> dict:
    """Return safe metadata for a dummy agent, without starting a run."""
    return {"agentId": "demo-node", "framework": "Custom", "status": "Active", "mock": True}

@mcp.tool()
def recent_activity() -> dict:
    """Return authored telemetry summaries, never hidden model reasoning."""
    return {"mock": True, "events": [{"kind": "Decision summary", "summary": "Selected a read-only source within the configured scope.", "outcome": "Success"}]}

# Start via: mcp run agent_node.py --transport streamable-http
