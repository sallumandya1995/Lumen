"""CrewAI native events; only task/tool/model metadata is retained.

The running root is sent immediately. Child events are sorted after the native
bus flush so threaded/out-of-order callbacks preserve actual parent relationships.
"""
import threading
import weakref
from crewai.events import BaseEventListener, TaskStartedEvent, TaskCompletedEvent, TaskFailedEvent, ToolUsageStartedEvent, ToolUsageFinishedEvent, ToolUsageErrorEvent, LLMCallStartedEvent, LLMCallCompletedEvent, LLMCallFailedEvent
from crewai.events.event_bus import crewai_event_bus


class LumenCrewObserver(BaseEventListener):
    def __init__(self, client, crew):
        self.client, self.crew = client, crew
        self.active = False
        self.root = None
        self.events = []
        self.lock = threading.RLock()
        self.task_ids = {str(task.id) for task in crew.tasks}
        super().__init__()

    def setup_listeners(self, bus):
        kinds = {TaskStartedEvent: ('task', 'start'), TaskCompletedEvent: ('task', 'end'), TaskFailedEvent: ('task', 'error'), ToolUsageStartedEvent: ('tool', 'start'), ToolUsageFinishedEvent: ('tool', 'end'), ToolUsageErrorEvent: ('tool', 'error'), LLMCallStartedEvent: ('model', 'start'), LLMCallCompletedEvent: ('model', 'end'), LLMCallFailedEvent: ('model', 'error')}
        owner_ref = weakref.ref(self)
        def handler(kind, phase):
            def capture(source, event):
                observer = owner_ref()
                if observer is None:
                    return
                task_id = str(getattr(event, 'task_id', None) or getattr(source, 'id', ''))
                with observer.lock:
                    if not observer.active or task_id not in observer.task_ids:
                        return
                    usage = getattr(event, 'usage', None)
                    if hasattr(usage, 'model_dump'):
                        usage = usage.model_dump()
                    usage = usage if isinstance(usage, dict) else {}
                    observer.events.append({'kind': kind, 'phase': phase, 'task_id': task_id, 'event_id': str(getattr(event, 'event_id', '')), 'started_event_id': str(getattr(event, 'started_event_id', '') or ''), 'call_id': str(getattr(event, 'call_id', '') or ''), 'name': str(getattr(event, 'tool_name', '') or getattr(source, 'name', '') or ('Model call' if kind == 'model' else 'CrewAI task')), 'model': str(getattr(event, 'model', '') or ''), 'at': int(event.timestamp.timestamp() * 1_000_000_000), 'input_tokens': usage.get('input_tokens', usage.get('prompt_tokens')), 'output_tokens': usage.get('output_tokens', usage.get('completion_tokens'))})
            return capture
        for event_class, (kind, phase) in kinds.items():
            bus.on(event_class)(handler(kind, phase))

    def __enter__(self):
        with self.lock:
            if self.active:
                raise RuntimeError('Use one observer per concurrent Crew invocation')
            self.events.clear()
            self.root = self.client.trace(getattr(self.crew, 'name', None) or 'CrewAI workflow')
            self.active = True
        return self

    def __exit__(self, exc_type, exc, tb):
        flushed = crewai_event_bus.flush(timeout=15)
        with self.lock:
            self.active = False
            tasks, open_spans, event_keys = {}, {}, {}
            for item in sorted(self.events, key=lambda e: (e['at'], e['phase'] != 'start')):
                kind = item['kind']
                fallback = (kind, item['task_id'], item['call_id'] if kind == 'model' else item['name'] if kind == 'tool' else '')
                if item['phase'] == 'start':
                    parent = tasks.get(item['task_id']) if kind != 'task' else None
                    span = (parent or self.root).span(item['name'], operation='chat' if kind == 'model' else 'execute_tool' if kind == 'tool' else 'invoke_agent', tool=item['name'] if kind == 'tool' else None, model=item['model'] or None, start_time_ns=item['at'])
                    event_keys[item['event_id']] = fallback
                    open_spans.setdefault(fallback, []).append(span)
                    if kind == 'task':
                        tasks[item['task_id']] = span
                else:
                    lookup = event_keys.get(item['started_event_id'], fallback)
                    queue = open_spans.get(lookup, [])
                    if not queue:
                        continue  # Never fabricate a duration for a missing start.
                    span = queue.pop(0)
                    if item['input_tokens'] is not None and item['output_tokens'] is not None:
                        span.usage(item['input_tokens'], item['output_tokens'])
                    span.summary('CrewAI '+kind+' '+('failed' if item['phase'] == 'error' else 'completed'))
                    span.end(item['phase'] == 'error', end_time_ns=item['at'])
                    if kind == 'task':
                        tasks.pop(item['task_id'], None)
            unfinished = [span for spans in open_spans.values() for span in spans]
            for span in unfinished:
                span.summary('Crew ended before this operation reported completion')
                span.end(True)
            self.events.clear()
            self.root.summary('Crew execution failed' if exc else 'Crew execution returned; native event metadata recorded')
            self.root.end(exc is not None or bool(unfinished) or not flushed)
        return False
