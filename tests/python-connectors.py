"""Run with the downloaded adapters and real framework packages on PYTHONPATH."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
from typing import TypedDict
from lumen_connectors import LumenClient
from lumen_connectors.langgraph import LumenCallbackHandler
from lumen_connectors.crewai import LumenCrewObserver
from lumen_connectors.mcp import observed_call_tool
from langgraph.graph import StateGraph, START, END
from langchain_core.tools import tool
from crewai import Agent, Crew, Task, BaseLLM

os.environ['CREWAI_TELEMETRY_OPT_OUT'] = 'true'
os.environ['OTEL_SDK_DISABLED'] = 'true'
KEY='lum_'+('a'*24)+'.'+('b'*64)
client=LumenClient('https://lumen.example/api/telemetry/v1/traces',KEY,'a-support',outbox=':memory:',auto_flush=False)

class State(TypedDict):
    request: str
    answer: str

@tool
def account_lookup(customer_id: str) -> str:
    """Return an in-memory account fixture for connector verification."""
    return 'Account fixture loaded: '+customer_id

def lookup(state: State):
    return {'answer':account_lookup.invoke({'customer_id':'C-1024'})}

graph=StateGraph(State);graph.add_node('lookup',lookup);graph.add_edge(START,'lookup');graph.add_edge('lookup',END)
answer=graph.compile().invoke({'request':'Review an account','answer':''},config={'callbacks':[LumenCallbackHandler(client)]})
assert 'Account fixture loaded' in answer['answer']

class LocalLLM(BaseLLM):
    model: str = 'connector-test-model'
    def call(self, messages, tools=None, callbacks=None, available_functions=None, **kwargs):
        return 'Final Answer: Verify the two payment references and draft a clear customer reply.'
    def supports_function_calling(self):
        return False
    def get_context_window_size(self):
        return 4096

agent=Agent(role='Support reviewer',goal='Review the account request',backstory='You prepare concise internal support notes.',llm=LocalLLM(model='connector-test-model'),verbose=False,allow_delegation=False)
task=Task(description='Review a duplicate subscription charge.',expected_output='One concise recommendation.',agent=agent)
crew=Crew(agents=[agent],tasks=[task],verbose=False,tracing=False)
with LumenCrewObserver(client,crew):
    output=crew.kickoff()
assert 'payment references' in str(output)

class MCPSession:
    async def call_tool(self,name,arguments):
        assert name=='crm_lookup' and arguments=={'customer_id':'C-1024'}
        return type('Result',(),{'isError':False,'content':'Fixture account returned'})()

async def mcp_test():
    with client.trace('MCP account review') as run:
        result=await observed_call_tool(run,MCPSession(),'crm_lookup',{'customer_id':'C-1024'})
        assert result.content=='Fixture account returned'
asyncio.run(mcp_test())

rows=[json.loads(row[0]) for row in client.db.execute('SELECT body FROM outbox ORDER BY id')]
spans=[r['resourceSpans'][0]['scopeSpans'][0]['spans'][0] for r in rows]
final={s['spanId']:s for s in spans if s.get('endTimeUnixNano')}
assert len(final)>=7,[(s['name'],s['status']) for s in final.values()]
assert all(s['status']['code']==1 for s in final.values()),[(s['name'],s['status']) for s in final.values()]
assert any(s['name']=='account_lookup' for s in final.values())
assert any(s['name']=='CrewAI task' or 'Review a duplicate' in s['name'] for s in final.values())
assert any(s['name']=='crm_lookup' for s in final.values())
assert not any('messages' in str(s) or 'Final Answer' in str(s) or 'customer_id' in str(s) for s in spans)
for span in final.values():
    if span['parentSpanId']:
        assert span['parentSpanId'] in final
out=Path('.sites-runtime/governance-server-tests');out.mkdir(parents=True,exist_ok=True)
(out/'python-telemetry.json').write_text(json.dumps(rows),encoding='utf-8')

# Verify queue retention across process/client restart without storing the key.
with tempfile.TemporaryDirectory() as directory:
    path=Path(directory)/'outbox.sqlite'
    first=LumenClient('https://lumen.example/api/telemetry/v1/traces',KEY,'a-support',outbox=str(path),auto_flush=False)
    with first.trace('Durable delivery'):
        pass
    first.db.close()
    second=LumenClient('https://lumen.example/api/telemetry/v1/traces',KEY,'a-support',outbox=str(path),auto_flush=False)
    assert second.db.execute('SELECT count(*) FROM outbox').fetchone()[0]==2
    assert KEY.encode() not in path.read_bytes()
    second.db.close()
print('PASS: real LangGraph graph + tool callbacks, real CrewAI task lifecycle, MCP wrapper call/result, parent trace relationships, metadata-only capture, and durable outbox restart.')
