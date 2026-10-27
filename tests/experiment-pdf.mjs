import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';

const dir=new URL('../.sites-runtime/experiment-pdf-tests/',import.meta.url);await mkdir(dir,{recursive:true});
for(const name of ['models.mjs','chat-settings.mjs'])await writeFile(new URL(name,dir),await readFile(new URL('../lib/'+name,import.meta.url)));
for(const name of ['experiments','experiment-pdf']){
 const source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("from './experiments'","from './experiments.mjs'");
 await writeFile(new URL(name+'.mjs',dir),output);
}
const {buildExperimentPdf}=await import(new URL('experiment-pdf.mjs',dir));
const fontBytes=new Uint8Array(await readFile(new URL('../public/fonts/DejaVuSans.ttf',import.meta.url)));
const base={id:'pdf-1',label:'Focused / baseline',model:'nvidia/Nemotron-3-Ultra-550b-a55b',systemPrompt:'Answer clearly. Preserve uncertainty. This is synthetic export test data.',parameters:{temperature:.2,top_p:.95,max_tokens:2048},pricing:{inputPerMillion:.5,outputPerMillion:1.5}};
const text='The sky appears blue because air scatters shorter blue wavelengths more than red light. This is an explanation, not a probability-based fact check.';
function tokens(content){return (content.match(/\S+\s*/g)||[]).map((token,i)=>({token,logprob:-.05-i*.01,top_logprobs:[{token,logprob:-.05-i*.01},{token:' alternative',logprob:-4}]}))}
const result={variant:base,status:'success',content:text,logprobs:tokens(text),usage:{inputTokens:120,outputTokens:60,totalTokens:180},durationMs:1234,finishReason:'stop'};
const run={id:'synthetic-export-qa',createdAt:'2026-10-22T12:00:00.000Z',prompt:'Explain why the sky appears blue in two sentences.\nInclude café and привет if useful.',results:[result,{...structuredClone(result),variant:{...base,id:'pdf-2',label:'Creative teacher',parameters:{temperature:.8,top_p:1,max_tokens:2048}},content:'Air scatters blue light more than red light, making the sky look blue. Think of the atmosphere as a café that serves blue light in every direction.',logprobs:tokens('Air scatters blue light more than red light, making the sky look blue. Think of the atmosphere as a café that serves blue light in every direction.')},{variant:{...base,id:'pdf-3',label:'Failed variant',pricing:null},status:'error',error:'Synthetic provider unavailable. Other variants completed.',durationMs:987},{...structuredClone(result),variant:{...base,id:'pdf-4',label:'Unicode and unknown usage',pricing:null},content:'café · привет · مرحبا · 中文',logprobs:[],usage:{inputTokens:null,outputTokens:null,totalTokens:null}}]};
const bytes=await buildExperimentPdf(run,base.id,fontBytes);
assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
const pdf=await PDFDocument.load(bytes);assert(pdf.getPageCount()>=5);assert(pdf.getPageCount()<20);
assert.equal(pdf.getTitle(),'Lumen - Prompt and model comparison');
await writeFile(new URL('report.pdf',dir),bytes);
await writeFile(new URL('expected-data.json',dir),JSON.stringify(run,null,2));
console.log(`Experiment PDF passed: ${pdf.getPageCount()} paginated pages, embedded font, text differences, token evidence, failed variants, unknown usage/pricing, Unicode rendering/fallback, and full JSON attachment. Fixture: ${new URL('report.pdf',dir).pathname}`);
