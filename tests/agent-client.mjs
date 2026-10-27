import assert from 'node:assert/strict';
import {runAgentExecution} from '../lib/agent-execution/client.ts';
const originalFetch=globalThis.fetch;
const request={agent:{id:'a-test'},definition:{revision:2,model:{name:'nvidia/Nemotron-3-Ultra-550b-a55b'}},input:'Summarize this case'};
const at=new Date().toISOString(),node={nodeId:'worker',label:'Worker',kind:'Agent',status:'Success',input:'test',output:'Résumé ready',summary:'Prepared summary',at,duration:20,tokens:9,cost:0};
const complete={id:'RUN-test',agentId:'a-test',configurationRevision:2,mode:'agent',input:request.input,output:node.output,status:'Success',at,duration:25,tokens:9,cost:0,costKnown:false,model:request.definition.model.name,nodes:[node],policies:[],warnings:[]};
const start={type:'start',id:'RUN-test',at};
function streamEvents(events,chunkSize=7){const bytes=new TextEncoder().encode(events.map(e=>JSON.stringify(e)).join('\n'));let offset=0;return new Response(new ReadableStream({pull(c){if(offset>=bytes.length){c.close();return}c.enqueue(bytes.slice(offset,offset+chunkSize));offset+=chunkSize}}))}
try{
 let events=[];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/agent-run');assert(!options.headers.Authorization);return streamEvents([start,{type:'node-result',node},{type:'complete',result:complete}])};
 assert.deepEqual(await runAgentExecution(request,{onEvent:event=>events.push(event.type)}),complete);
 assert.deepEqual(events,['start','node-result','complete']);
 globalThis.fetch=async()=>streamEvents([start,{type:'node-result',node}]);
 const partial=await runAgentExecution(request);assert.equal(partial.status,'Failed');assert.equal(partial.nodes[0].output,node.output);assert.equal(partial.output,'');
 assert(!Object.hasOwn(partial,'globalPolicyRevision'));
 const governedRequest={...request,globalPolicies:{revision:7,rules:[]}};
 assert.equal((await runAgentExecution(governedRequest)).globalPolicyRevision,7,'Interrupted runs retain the requested global-policy revision.');
 globalThis.fetch=async()=>streamEvents([start,{type:'complete',result:{...complete,globalPolicyRevision:7}}]);
 assert.equal((await runAgentExecution(governedRequest)).status,'Success');
 globalThis.fetch=async()=>streamEvents([start,{type:'complete',result:{...complete,globalPolicyRevision:6}}]);
 assert.equal((await runAgentExecution(governedRequest)).status,'Failed','A mismatched policy revision cannot be accepted as a matching completed run.');
 globalThis.fetch=async()=>streamEvents([start,{type:'complete',result:{...complete,agentId:'other'}}]);
 assert.equal((await runAgentExecution(request)).status,'Failed');
 const controller=new AbortController();globalThis.fetch=async()=>streamEvents([start,{type:'node-result',node},{type:'complete',result:complete}],1);
 const stopped=await runAgentExecution(request,{signal:controller.signal,onEvent:e=>{if(e.type==='node-result')controller.abort()}});
 assert.equal(stopped.status,'Cancelled');assert.deepEqual(stopped.nodes,[node]);assert.equal(stopped.tokens,9);
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'API key unavailable.'}),{status:503});
 await assert.rejects(()=>runAgentExecution(request),/API key unavailable/);
 globalThis.fetch=async()=>streamEvents([start,{type:'error',message:'A node failed'}]);
 assert((await runAgentExecution(request)).warnings.some(w=>w.includes('A node failed')));
 console.log('Execution client checks passed: split NDJSON, Unicode, matching completion, lost streams, stop, server errors.');
}finally{globalThis.fetch=originalFetch}
