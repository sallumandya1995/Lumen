"""Backend-side MCP example. It connects only when explicitly run by an operator.

The dashboard connector test NEVER invokes this module or connects to a real node.
An agent node exposes safe metadata and sanitized telemetry through MCP tools;
CrewAI/LangGraph adapters should publish the same telemetry contract.
"""
import asyncio
import os
import json
from urllib.parse import urlparse
from mcp import Client

def sanitized_status(result) -> dict:
    if result.is_error:
        raise ValueError("The agent node returned a tool error")
    content = result.structured_content
    if content is None:
        text = next((c.text for c in result.content if getattr(c, "type", None) == "text"), "{}")
        content = json.loads(text)
    if not isinstance(content, dict):
        raise ValueError("Expected agent metadata")
    return {"agentId": content.get("agentId"), "framework": content.get("framework"), "status": content.get("status"), "mock": content.get("mock", True)}

async def inspect_agent_node() -> dict:
    endpoint = os.getenv("AGENT_MCP_URL", "http://localhost:8000/mcp")
    url = urlparse(endpoint)
    allowed_hosts = os.getenv("MCP_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if url.hostname not in allowed_hosts or url.username or url.password or url.query:
        raise ValueError("Endpoint must be server-configured and on MCP_ALLOWED_HOSTS")
    if url.scheme != "https" and url.hostname not in ["localhost", "127.0.0.1"]:
        raise ValueError("Remote MCP endpoints must use HTTPS")
    async with asyncio.timeout(15):
        async with Client(endpoint) as node:
            # Only these read-only demo tools are called. No arbitrary execution endpoint.
            result = await node.call_tool("agent_status", {})
            return sanitized_status(result)

if __name__ == "__main__":
    print(asyncio.run(inspect_agent_node()))
