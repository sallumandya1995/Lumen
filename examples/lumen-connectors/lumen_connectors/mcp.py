"""Wrap an already authenticated MCP ClientSession in the agent backend."""
async def observed_call_tool(run, session, name, arguments):
    with run.span(name, operation="execute_tool", tool=name) as span:
        result = await session.call_tool(name, arguments=arguments)
        if getattr(result, "isError", False):
            span.summary("MCP server reported a tool error")
            span.end(True)
        else:
            span.summary("MCP server returned a tool result")
        return result
