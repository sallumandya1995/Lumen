import {PDFDocument,rgb,type PDFFont,type PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {modelConfig} from './models.mjs';
import {resultMetrics,tokenDifferences,type ExperimentRun} from './experiments';

const INK=rgb(.04,.17,.24),MUTED=rgb(.36,.46,.51),LIME=rgb(.85,1,.21),LINE=rgb(.85,.9,.91),PALE=rgb(.95,.97,.98),AMBER=rgb(.99,.91,.68);
const cost=(value:number|null)=>value===null?'Not priced':value===0?'$0.000000':value<.000001?'< $0.000001':'$'+value.toFixed(6);
let fontPromise:Promise<Uint8Array>|null=null;
async function loadFont(){
 if(!fontPromise)fontPromise=fetch('/fonts/DejaVuSans.ttf',{signal:AbortSignal.timeout(30000)}).then(async response=>{if(!response.ok)throw Error('The report font could not be loaded. Please try again.');return new Uint8Array(await response.arrayBuffer())}).catch(error=>{fontPromise=null;throw error});
 return fontPromise;
}

/** A real downloadable PDF, with a complete UTF-8 data attachment for reproducibility. */
export async function buildExperimentPdf(run:ExperimentRun,baselineId?:string,fontBytes?:Uint8Array){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const font=await pdf.embedFont(fontBytes||await loadFont(),{subset:true});
 pdf.setTitle('Lumen - Prompt and model comparison');pdf.setAuthor('Lumen');pdf.setSubject('Experiment settings, responses, usage, probabilities, and token differences');
 const baseline=run.results.find(r=>r.variant.id===baselineId&&r.status==='success')||run.results.find(r=>r.status==='success');
 const data={format:'lumen-experiment-v1',exportedAt:new Date().toISOString(),baselineId:baseline?.variant.id??null,notes:{latency:'Client-observed request latency including network and model time; excludes queue.',tokenUsage:'Provider counts can include reasoning tokens. Mean log probability covers visible recorded answer tokens only.',cost:'USD estimate from the custom rates captured with this run; excludes discounts and taxes.',diff:'Visible-text alignment mapped to provider token boundaries. Long responses can use a broader changed region.'},run};
 const raw=JSON.stringify(data,null,2);
 await pdf.attach(new TextEncoder().encode(raw),'lumen-experiment-data.json',{mimeType:'application/json',description:'Complete experiment input, system prompts, parameters, responses, usage, log probabilities and returned alternatives.'});
 const supported=new Set(font.getCharacterSet());
 const safe=(value:string)=>Array.from(value).map(c=>c==='\n'||c==='\r'||c==='\t'||supported.has(c.codePointAt(0)!)?c:`[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`).join('');
 const hasUnsupported=Array.from(raw).some(c=>!['\n','\r','\t'].includes(c)&&!supported.has(c.codePointAt(0)!));
 const W=595.28,H=841.89,M=40,CW=W-2*M;let page!:PDFPage,y=0;
 function addPage(){page=pdf.addPage([W,H]);page.drawText('LUMEN  /  EXPERIMENT REPORT',{x:M,y:H-31,size:8,font,color:MUTED});page.drawLine({start:{x:M,y:H-42},end:{x:W-M,y:H-42},thickness:.6,color:LINE});y=H-65;return page}
 function ensure(height:number){if(y-height<48)addPage()}
 function lines(text:string,size:number,width=CW){
  const output:string[]=[];
  for(const paragraph of safe(text).replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n')){
   let line='';
   for(const word of paragraph.match(/\S+| +/g)||[]){
    if(font.widthOfTextAtSize(line+word,size)<=width){line+=word;continue}
    if(line){output.push(line);line=''}
    if(font.widthOfTextAtSize(word,size)<=width){line=word;continue}
    for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>width){output.push(line);line=''}line+=char}
   }
   output.push(line);
  }
  return output;
 }
 function paragraph(text:string,size=10,color=INK,gap=8){for(const line of lines(text,size)){ensure(size*1.55);page.drawText(line,{x:M,y,size,font,color});y-=size*1.55}y-=gap}
 function heading(text:string,size=16){ensure(size*1.6+20);y-=8;paragraph(text,size,INK,10)}
 let lastHeader:{cells:string[];widths:number[]}|null=null;
 function row(cells:string[],widths:number[],header=false){
  if(header)lastHeader={cells,widths};
  const size=header?7.5:8,wrapped=cells.map((c,i)=>lines(c,size,widths[i]-12));
  const height=Math.max(...wrapped.map(l=>l.length))*12+12;
  if(y-height-5<48){addPage();if(!header&&lastHeader)row(lastHeader.cells,lastHeader.widths,true)}
  if(header)page.drawRectangle({x:M,y:y-height+5,width:CW,height,color:PALE});
  let x=M;
  wrapped.forEach((cell,i)=>{cell.forEach((line,n)=>page.drawText(line,{x:x+6,y:y-7-n*12,size,font,color:header?MUTED:INK}));x+=widths[i]});
  y-=height;page.drawLine({start:{x:M,y:y+5},end:{x:W-M,y:y+5},thickness:.4,color:LINE});
 }
 function coloredResponse(segments:{text:string;changed:boolean}[]){
  const size=10.2,leading=16;let x=M;
  const newline=()=>{x=M;y-=leading;ensure(leading)};
  ensure(leading);
  for(const segment of segments){
   const text=safe(segment.text).replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
   for(const atom of text.match(/\n|[^\S\n]+|[^\s]+/g)||[]){
    if(atom==='\n'){newline();continue}
    const width=font.widthOfTextAtSize(atom,size);
    if(width<=CW){
     if(x>M&&x+width>W-M)newline();
     if(segment.changed&&width)page.drawRectangle({x,y:y-3,width,height:leading,color:AMBER});
     page.drawText(atom,{x,y,size,font,color:INK});x+=width;
    }else{
     for(const char of atom){const w=font.widthOfTextAtSize(char,size);if(x+w>W-M)newline();if(segment.changed)page.drawRectangle({x,y:y-3,width:w,height:leading,color:AMBER});page.drawText(char,{x,y,size,font,color:INK});x+=w}
    }
   }
  }
  y-=leading+12;
 }

 addPage();
 page.drawRectangle({x:M,y:y-5,width:6,height:29,color:LIME});
 page.drawText('One prompt. More perspectives.',{x:M+17,y,size:23,font,color:INK});y-=34;
 paragraph('Prompt and model comparison',12,MUTED,10);
 paragraph(`Run: ${run.id}\nStarted: ${run.createdAt}\nExported: ${data.exportedAt}`,8,MUTED,12);
 heading('Shared prompt');paragraph(run.prompt,11);
 heading('Comparison at a glance');
 const widths=[85,130,57,64,90,CW-426];
 row(['Variant / status','Model','Latency','Output tokens','Est. cost USD','Mean log P'],widths,true);
 for(const result of run.results){const m=resultMetrics(result);row([result.variant.label+'\n'+result.status,modelConfig(result.variant.model)?.label||result.variant.model,result.durationMs===undefined?'N/A':(result.durationMs/1000).toFixed(2)+'s',m.outputTokens===null?'N/A':String(m.outputTokens),cost(m.estimatedCostUsd),m.averageLogprob===null?'N/A':m.averageLogprob.toFixed(4)],widths)}
 y-=14;
 paragraph('Token counts are provider-reported and may include reasoning. Mean log P covers recorded visible answer tokens, is model-specific, and is not a quality or factual-confidence score. Cost uses your saved USD-per-million rates; unset rates or missing usage are not treated as zero.',8,MUTED);
 paragraph(`Difference baseline: ${baseline?.variant.label||'No successful variant'}. Amber highlights additions or changes relative to the baseline. Omitted text is listed separately. The complete machine-readable data is attached to this PDF as lumen-experiment-data.json.`,8,MUTED);
 if(hasUnsupported)paragraph('Some characters are outside the report font and are shown as Unicode code-point escapes. The embedded UTF-8 JSON preserves all original text.',8,MUTED);

 for(const [index,result] of run.results.entries()){
  addPage();heading(`${String(index+1).padStart(2,'0')}  ${result.variant.label}`,20);
  paragraph(`${modelConfig(result.variant.model)?.label||result.variant.model} / ${result.status.toUpperCase()}`,10,MUTED);
  paragraph(`Model ID: ${result.variant.model}\nEndpoint: ${modelConfig(result.variant.model)?.baseUrl||'Unavailable'}\nTemperature: ${result.variant.parameters.temperature} | Top P: ${result.variant.parameters.top_p} | Max tokens: ${result.variant.parameters.max_tokens}`,9);
  heading('System prompt',13);paragraph(result.variant.systemPrompt||'No system prompt supplied.',9);
  const metrics=resultMetrics(result),usage=result.usage;
  heading('Recorded metrics',13);
  paragraph(`Latency: ${result.durationMs===undefined?'Unavailable':(result.durationMs/1000).toFixed(3)+' seconds'}\nInput tokens: ${usage?.inputTokens??'Unavailable'} | Output tokens: ${usage?.outputTokens??'Unavailable'} | Total: ${usage?.totalTokens??'Unavailable'}\nRecorded visible answer tokens: ${metrics.visibleTokens}\nMean visible-token log probability: ${metrics.averageLogprob===null?'Unavailable':metrics.averageLogprob.toFixed(6)}\nEstimated cost: ${cost(metrics.estimatedCostUsd)}\nRates, USD / 1M tokens: ${result.variant.pricing?`input ${result.variant.pricing.inputPerMillion}, output ${result.variant.pricing.outputPerMillion}`:'Not configured'}\nFinish reason: ${result.finishReason||'Unavailable'}`,9);
  if(result.error){heading('Execution notice',13);paragraph(result.error,10);continue}
  if(result.finishReason==='length')paragraph('Output reached its token limit and may be incomplete.',9,MUTED);
  if(result.warning)paragraph(result.warning,8,MUTED);
  heading('Response',13);
  const diff=baseline&&baseline.variant.id!==result.variant.id?tokenDifferences(baseline.content||'',result.content||'',result.logprobs):null;
  coloredResponse(diff?.segments||[{text:result.content||'No response recorded.',changed:false}]);
  if(diff?.coarse)paragraph('Long-response comparison uses a broader changed region.',8,MUTED);
  if(diff?.removedText){heading('Omitted from baseline',12);paragraph('Unchanged gaps between removed fragments are marked [...].',8,MUTED);paragraph(diff.removedText,9,rgb(.57,.28,.32))}
  const tokens=result.logprobs||[];
  if(tokens.length){
   ensure(140);heading('Token evidence',13);
   paragraph(`First ${Math.min(100,tokens.length)} of ${tokens.length} recorded visible tokens. Up to three alternatives per row. All returned alternatives for every token are preserved in the embedded JSON. Probabilities use exp(log P) x 100.`,8,MUTED);
   const tokenWidths=[90,65,75,CW-230];row(['Token','Log P','Probability','Top alternatives'],tokenWidths,true);
   const short=(text:string)=>Array.from(text).slice(0,70).join('')+(Array.from(text).length>70?'...':'');
   const prob=(lp:number)=>Number.isFinite(lp)&&lp<=0&&lp>-9999?(Math.exp(lp)*100).toPrecision(5)+'%':'N/A';
   for(const token of tokens.slice(0,100))row([short(JSON.stringify(token.token)),Number.isFinite(token.logprob)&&token.logprob>-9999?token.logprob.toFixed(5):'N/A',prob(token.logprob),[...(token.top_logprobs||[])].sort((a,b)=>b.logprob-a.logprob).slice(0,3).map(t=>short(JSON.stringify(t.token))+' '+prob(t.logprob)).join('\n')],tokenWidths);
  }else paragraph('The provider did not supply aligned token probabilities for this response.',8,MUTED);
 }
 const pages=pdf.getPages();
 pages.forEach((p,i)=>{p.drawLine({start:{x:M,y:35},end:{x:W-M,y:35},thickness:.5,color:LINE});p.drawText('Lumen - clarity for AI',{x:M,y:21,size:7,font,color:MUTED});p.drawText(`${i+1} / ${pages.length}`,{x:W-M-40,y:21,size:7,font,color:MUTED})});
 return pdf.save();
}
