"""LangGraph/LangChain native callback adapter. No prompt or reasoning capture."""
import threading
import uuid
from langchain_core.callbacks import BaseCallbackHandler
from .client import Span


class LumenCallbackHandler(BaseCallbackHandler):
    run_inline = True

    def __init__(self, client):
        self.client = client
        self.spans = {}
        self.lock = threading.RLock()

    def _start(self, run_id, parent_run_id, name, operation="invoke_agent", tool=None, model=None):
        with self.lock:
            parent = self.spans.get(str(parent_run_id))
            span = Span(self.client, name, parent.value["traceId"] if parent else uuid.uuid4().hex, parent.value["spanId"] if parent else "", operation, tool, model)
            self.spans[str(run_id)] = span

    def _end(self, run_id, failed=False, response=None):
        with self.lock:
            span = self.spans.pop(str(run_id), None)
            if not span:
                return
            if response is not None:
                output = getattr(response, "llm_output", None) or {}
                usage = output.get("token_usage", {})
                try:
                    message = response.generations[0][0].message
                    usage = getattr(message, "usage_metadata", None) or usage
                    model = (getattr(message, "response_metadata", None) or {}).get("model_name")
                    if model:
                        span.attrs["gen_ai.request.model"] = str(model)[:200]
                except (AttributeError, IndexError, TypeError):
                    pass
                if usage:
                    span.usage(usage.get("input_tokens", usage.get("prompt_tokens", 0)), usage.get("output_tokens", usage.get("completion_tokens", 0)))
            span.summary("Framework callback recorded a failed operation" if failed else "Framework callback recorded a completed operation")
            span.end(failed)

    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, **kwargs):
        self._start(run_id, parent_run_id, kwargs.get("name") or (serialized or {}).get("name") or "Graph step")

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        self._end(run_id)

    def on_chain_error(self, error, *, run_id, **kwargs):
        self._end(run_id, True)

    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, **kwargs):
        name = (serialized or {}).get("name") or "tool"
        self._start(run_id, parent_run_id, name, "execute_tool", tool=name)

    def on_tool_end(self, output, *, run_id, **kwargs):
        self._end(run_id)

    def on_tool_error(self, error, *, run_id, **kwargs):
        self._end(run_id, True)

    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, **kwargs):
        model = (kwargs.get("invocation_params") or {}).get("model") or (serialized or {}).get("name")
        self._start(run_id, parent_run_id, "Model call", "chat", model=model)

    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, **kwargs):
        self.on_chat_model_start(serialized, [], run_id=run_id, parent_run_id=parent_run_id, **kwargs)

    def on_llm_end(self, response, *, run_id, **kwargs):
        self._end(run_id, response=response)

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._end(run_id, True)
