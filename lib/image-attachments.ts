export type ImageAttachment={id:string;name:string;dataUrl?:string;context?:string;visionModel?:string};
export type ImageContext=Pick<ImageAttachment,'id'|'name'|'context'|'visionModel'>;
export const MAX_IMAGES=3;
export const MAX_IMAGE_FILE_BYTES=10*1024*1024;
export const MAX_IMAGE_DATA_URL_LENGTH=2*1024*1024;
export const MAX_IMAGE_CONTEXT_LENGTH=12000;
export const IMAGE_TYPES=['image/png','image/jpeg','image/webp'];
export const IMAGE_PROMPT='Describe the attached image(s).';

function aborted(signal?:AbortSignal){if(signal?.aborted)throw new DOMException('Cancelled','AbortError')}
function validIdentity(image:unknown):image is ImageAttachment{
 const v=image as ImageAttachment;
 return !!v&&typeof v==='object'&&typeof v.id==='string'&&!!v.id&&v.id.length<=100&&typeof v.name==='string'&&!!v.name&&v.name.length<=200;
}
function prepared(image:ImageAttachment){return typeof image.context==='string'&&!!image.context.trim()&&image.context.length<=MAX_IMAGE_CONTEXT_LENGTH&&typeof image.visionModel==='string'&&!!image.visionModel&&image.visionModel.length<=200}
function validateSet(images:ImageAttachment[]){
 if(!Array.isArray(images)||images.length>MAX_IMAGES||images.some(image=>!validIdentity(image))||new Set(images.map(image=>image.id)).size!==images.length)throw new Error('Attach up to three images with valid names.');
}

/** Only derived image context travels to the text-generation endpoints. */
export function imageContexts(images:ImageAttachment[]):ImageContext[]{
 validateSet(images);
 if(images.some(image=>!prepared(image)))throw new Error('An image still needs to be read. Retry image analysis before continuing.');
 return images.map(({id,name,context,visionModel})=>({id,name,context,visionModel}));
}

/** Never persist pixels in localStorage. Callers should not save an incomplete image set. */
export function storedImageContexts(images:ImageAttachment[]):ImageContext[]{return imageContexts(images.filter(prepared))}

/** Missing legacy image state is valid; broken saved context must be surfaced, not discarded. */
export function restoreImageContexts(value:unknown):ImageAttachment[]{
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value))throw new Error('Saved image context could not be restored. Please attach the images again.');
 try{return imageContexts(value)}catch{throw new Error('Saved image context could not be restored. Please attach the images again.')}
}

type PrepareOptions={signal?:AbortSignal;onProgress?:(message:string)=>void;onPrepared?:(image:ImageAttachment)=>void;fetcher?:typeof fetch};
/** Read only new images. onPrepared retains partial successes if a later upload fails. */
export async function prepareImages(images:ImageAttachment[],options:PrepareOptions={}):Promise<ImageAttachment[]>{
 validateSet(images);aborted(options.signal);
 const result:ImageAttachment[]=[];
 for(let index=0;index<images.length;index++){
  const image=images[index];aborted(options.signal);
  if(prepared(image)){result.push(image);continue}
  if(typeof image.dataUrl!=='string'||image.dataUrl.length>MAX_IMAGE_DATA_URL_LENGTH||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))throw new Error(`Attach ${image.name} again so it can be read.`);
  options.onProgress?.(`Reading image ${index+1} of ${images.length}…`);
  const response=await (options.fetcher||fetch)('/api/images/describe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:image.id,name:image.name,dataUrl:image.dataUrl}),signal:options.signal});
  aborted(options.signal);
  let data:any;try{data=await response.json()}catch{throw new Error('The image reader returned an invalid response. Please retry.')}
  aborted(options.signal);
  if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'The image could not be read. Please retry.');
  const ready={...image,context:data?.context,visionModel:data?.model};
  if(data?.id!==image.id||!prepared(ready))throw new Error('The image reader did not return usable context. Please retry.');
  result.push(ready);options.onPrepared?.(ready);
 }
 return result;
}

/** Resize on the client before uploading, keeping screenshots legible without large payloads. */
export async function imageFromFile(file:File):Promise<ImageAttachment>{
 if(!IMAGE_TYPES.includes(file.type))throw new Error('Choose a PNG, JPEG, or WebP image.');
 if(!file.size||file.size>MAX_IMAGE_FILE_BYTES)throw new Error('Each image must be smaller than 10 MB.');
 const url=URL.createObjectURL(file),image=new Image();
 try{
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('This image could not be opened. Try a PNG, JPEG, or WebP file.'));image.src=url});
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('This image is too large to process. Please paste a smaller screenshot.');
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('Image processing is unavailable in this browser.');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  let dataUrl=file.type==='image/png'?canvas.toDataURL('image/png'):'';
  if(!dataUrl||dataUrl.length>MAX_IMAGE_DATA_URL_LENGTH){
   context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.9,.78,.6]){dataUrl=canvas.toDataURL('image/jpeg',quality);if(dataUrl.length<=MAX_IMAGE_DATA_URL_LENGTH)break}
  }
  if(!/^data:image\/(png|jpeg);base64,/.test(dataUrl)||dataUrl.length>MAX_IMAGE_DATA_URL_LENGTH)throw new Error('This image is too large to attach. Please use a smaller screenshot.');
  return {id:crypto.randomUUID(),name:(file.name.replace(/[\u0000-\u001f\u007f]/g,'').trim()||'Pasted image').slice(0,200),dataUrl};
 }finally{URL.revokeObjectURL(url)}
}
