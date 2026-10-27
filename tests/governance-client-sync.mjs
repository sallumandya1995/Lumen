import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';
const dir=new URL('../.sites-runtime/client-sync-tests/',import.meta.url);await mkdir(dir,{recursive:true});
const code=ts.transpileModule(await readFile(new URL('../lib/governance/hosted-client.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
await writeFile(new URL('client.mjs',dir),code);
const {createHostedService}=await import(new URL('client.mjs',dir));
const turn=()=>new Promise(r=>setImmediate(r));
const win=new EventTarget(),doc=new EventTarget(),timers=new Map();let timerId=0;
win.setInterval=fn=>{timers.set(++timerId,fn);return timerId};win.clearInterval=id=>timers.delete(id);doc.visibilityState='visible';
globalThis.window=win;globalThis.document=doc;globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
let revision=1,hold=false,held=[],failSave=false,reads=0;
const snapshot=()=>({fresh:false,revision,store:{version:1,agents:[{id:'a-shared',name:'Saved '+revision}],definitions:[{agentId:'a-shared',revision}],runs:[]}});
globalThis.fetch=async(_url,options)=>{
 assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');
 if(options.method==='POST'){if(failSave)return Response.json({error:'Revision conflict'},{status:409});revision++;return Response.json({ok:true,revision})}
 reads++;const value=snapshot();if(hold){hold=false;return new Promise((resolve,reject)=>held.push({resolve:()=>resolve(Response.json(value)),reject}))}return Response.json(value);
};
const studio=createHostedService(),governance=createHostedService();let studioEvents=0,governanceEvents=0;
const stopStudio=studio.subscribe(()=>studioEvents++),stopGovernance=governance.subscribe(()=>governanceEvents++);
await studio.load();await governance.load();assert.equal(timers.size,2);
// A pre-save response arrives after a post-save read. Neither caller may see old data.
hold=true;const oldRead=studio.load();await turn();assert.equal(held.length,1);
await studio.saveAgentConfiguration('a-shared',{},'owner');const fresh=await studio.load();assert.equal(fresh.definitions[0].revision,2);
held.shift().resolve();assert.equal((await oldRead).definitions[0].revision,2);
for(let i=0;i<20&&!governanceEvents;i++)await turn();assert(governanceEvents>0,'BroadcastChannel refreshes the other tab without its activity feed');
assert.equal((await governance.load()).definitions[0].revision,2);
// An obsolete failed read must not replace the success state following a save.
hold=true;const failedOld=studio.load();await turn();await studio.saveAgentConfiguration('a-shared',{},'owner');assert.equal((await studio.load()).definitions[0].revision,3);
held.shift().reject(Error('Old connection closed'));assert.equal((await failedOld).definitions[0].revision,3);
// Readers share one fetch; handing a snapshot to an editor cannot mutate the cached record.
const count=reads;const [a,b]=await Promise.all([studio.load(),studio.load()]);assert.equal(reads,count+1);a.agents[0].name='Unsaved draft';assert.equal(b.agents[0].name,'Saved 3');
const notifications=studioEvents;failSave=true;await assert.rejects(()=>studio.saveAgentConfiguration('a-shared',{},'owner'),/Revision conflict/);assert.equal(studioEvents,notifications);failSave=false;
const beforePoll=governanceEvents;timers.forEach(fn=>fn());assert(governanceEvents>beforePoll,'Configuration refresh continues independently of simulation');
doc.visibilityState='hidden';const beforeHidden=governanceEvents;timers.forEach(fn=>fn());assert.equal(governanceEvents,beforeHidden);
doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));assert(governanceEvents>beforeHidden);
stopStudio();stopGovernance();assert.equal(timers.size,0);
// Restricted browsers without BroadcastChannel use storage invalidation instead.
const originalBroadcast=globalThis.BroadcastChannel;globalThis.BroadcastChannel=undefined;
const fallback=createHostedService();let fallbackEvents=0;const stopFallback=fallback.subscribe(()=>fallbackEvents++);
const event=new Event('storage');Object.defineProperty(event,'key',{value:'lumen-workspace-changed'});win.dispatchEvent(event);assert.equal(fallbackEvents,1);stopFallback();globalThis.BroadcastChannel=originalBroadcast;
console.log('PASS: stale reads and obsolete errors cannot undo saves; reads are deduplicated and isolated; cross-tab, visibility, polling, storage fallback, and listener cleanup.');
