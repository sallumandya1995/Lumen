import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const dir=new URL('../.sites-runtime/workflow-view-tests/',import.meta.url);await mkdir(dir,{recursive:true});
for(const [source,target] of [['app/studio/graph.tsx','graph'],['app/governance/agent-workflow.tsx','workflow']]){
 const code=ts.transpileModule(await readFile(new URL('../'+source,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/import ['"][^'"]+\.css['"];?/g,'').replace("from '../studio/graph'","from './graph.mjs'");
 await writeFile(new URL(target+'.mjs',dir),code);
}
const {default:Workflow}=await import(new URL('workflow.mjs',dir));
const definition={agentId:'a-test',revision:6,nodes:[{id:'start',kind:'Input',label:'Customer request',description:'Incoming request',enabled:true,prompt:''},{id:'agent',kind:'Agent',label:'Billing investigator',description:'Review both charge references.',enabled:true,prompt:'Check the billing ledger & payment references.'},{id:'review',kind:'Sub-agent',label:'Evidence reviewer',description:'Review evidence',enabled:false,prompt:'Check missing information.',referencedAgentId:'a-other'},{id:'end',kind:'Output',label:'Customer reply',description:'Result',enabled:true,prompt:''}],edges:[{id:'edge-start',source:'start',target:'agent',label:'Task context'},{id:'edge-review',source:'agent',target:'review',label:'Review evidence'},{id:'edge-end',source:'review',target:'end',label:'Prepare reply'}]};
const render=d=>renderToStaticMarkup(React.createElement(Workflow,{definition:d,agents:[]}));
const markup=render(definition);
for(const text of ['Saved agent graph','Revision 6','Billing investigator','Evidence reviewer','Check the billing ledger &amp; payment references.','Task context','Review evidence','edge-review','Select to inspect.'])assert(markup.includes(text),text);
assert(!markup.includes('press Enter to edit and test'),'Governance must describe inspection, not offer editing');
const deleted=structuredClone(definition);deleted.revision++;deleted.nodes=deleted.nodes.filter(n=>n.id!=='review');deleted.edges=deleted.edges.filter(e=>e.source!=='review'&&e.target!=='review');deleted.edges.push({id:'edge-direct',source:'agent',target:'end',label:'Direct response'});
const updated=render(deleted);assert(updated.includes('Revision 7'));assert(updated.includes('Direct response'));assert(!updated.includes('Evidence reviewer'));assert(!updated.includes('edge-review'));
console.log('PASS: Governance renders the saved graph, node instructions, all directed edges, revision updates, deletions, and inspection-only labels.');
