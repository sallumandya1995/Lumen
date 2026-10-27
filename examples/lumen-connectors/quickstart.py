"""Run a real LangGraph workflow with a local read-only tool and send telemetry.

Set the three LUMEN_* environment variables from the Connect panel first.
This connectivity check does not call a model or contact a customer system.
"""
from typing import TypedDict
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END
from lumen_connectors import LumenClient
from lumen_connectors.langgraph import LumenCallbackHandler


class State(TypedDict):
    request: str
    summary: str


@tool
def review_charge(amount: int) -> str:
    """Prepare a read-only payment-verification checklist from the supplied amount."""
    return f"Compare the two ${amount} transaction references, settlement dates, and subscription period before making a refund decision."


def review(state: State):
    return {"summary": review_charge.invoke({"amount": 29})}


builder = StateGraph(State)
builder.add_node("Review charge", review)
builder.add_edge(START, "Review charge")
builder.add_edge("Review charge", END)
client = LumenClient.from_env()
try:
    result = builder.compile().invoke({"request": "Review a possible duplicate charge", "summary": ""}, config={"callbacks": [LumenCallbackHandler(client)]})
    print(result["summary"])
    client.flush()
    print("Telemetry delivered. Open Governance → Runs & performance → Live executions.")
finally:
    client.close()
