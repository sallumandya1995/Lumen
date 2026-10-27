'use client';
import {useCallback,useEffect,useRef,useState,type ClipboardEvent,type Dispatch,type SetStateAction} from 'react';
import {ImagePlus,Image as ImageIcon,X,Check} from 'lucide-react';
import {imageFromFile,MAX_IMAGES,type ImageAttachment} from '../lib/image-attachments';
import './image-attachments.css';

export function useImageAttachments({disabled=false}:{disabled?:boolean}={}){
 const [images,setImageState]=useState<ImageAttachment[]>([]),[processing,setProcessing]=useState(false),[error,setError]=useState('');
 const current=useRef(images),disabledRef=useRef(disabled),epoch=useRef(0),pending=useRef(0),mounted=useRef(true);
 disabledRef.current=disabled;
 const setImages=useCallback<Dispatch<SetStateAction<ImageAttachment[]>>>(value=>{const next=typeof value==='function'?value(current.current):value;current.current=next;if(mounted.current)setImageState(next)},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;pending.current=0}},[]);
 const clear=useCallback(()=>{epoch.current++;pending.current=0;setImages([]);setProcessing(false);setError('')},[setImages]);
 const remove=useCallback((id:string)=>{if(disabledRef.current)return;setImages(previous=>previous.filter(image=>image.id!==id));setError('')},[setImages]);
 const addFiles=useCallback(async(input:File[]|FileList)=>{
  if(disabledRef.current||!mounted.current)return;
  const files=Array.from(input);if(!files.length)return;
  if(files.length+current.current.length+pending.current>MAX_IMAGES){setError('You can attach up to three images. Remove one to add another.');return}
  const job=epoch.current;pending.current+=files.length;setProcessing(true);setError('');
  for(const file of files){
   if(job!==epoch.current||!mounted.current)return;
   try{const image=await imageFromFile(file);if(job===epoch.current&&mounted.current&&!disabledRef.current)setImages(previous=>[...previous,image])}
   catch(error){if(job===epoch.current&&mounted.current)setError(error instanceof Error?error.message:'This image could not be attached.')}
   finally{if(job===epoch.current&&mounted.current){pending.current--;setProcessing(pending.current>0)}}
  }
 },[setImages]);
 const onPaste=useCallback((event:ClipboardEvent)=>{
  if(disabledRef.current)return;
  const files=Array.from(event.clipboardData.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
  if(!files.length)return;
  // Keep accompanying plain text on the normal textarea paste path.
  if(!event.clipboardData.getData('text/plain'))event.preventDefault();
  void addFiles(files);
 },[addFiles]);
 return {images,setImages,processing,error,setError,onPaste,addFiles,clear,remove};
}

export function ImageAttachments({images,onRemove,disabled=false,compact=false}:{images:ImageAttachment[];onRemove?:(id:string)=>void;disabled?:boolean;compact?:boolean}){
 if(!images.length)return null;
 return <div className={'image-attachments'+(compact?' is-compact':'')} aria-label="Attached images">{images.map((image,index)=><article className="image-attachment" key={image.id}>
  <div className="image-attachment-preview">{image.dataUrl?<img src={image.dataUrl} alt={`Attached image ${index+1}: ${image.name}`}/>:<span className="image-attachment-restored"><ImageIcon size={22}/><small>Saved context</small></span>}{onRemove&&<button type="button" className="image-attachment-remove" aria-label={`Remove ${image.name}`} title="Remove image" disabled={disabled} onClick={()=>onRemove(image.id)}><X size={14}/></button>}</div>
  <div className="image-attachment-caption"><strong title={image.name}>{image.name}</strong><span>{image.context?<><Check size={11}/> Image context ready</>:<>Ready to read</>}</span></div>
  {image.context&&<details className="image-context-details"><summary>View image context</summary><p className="image-context-model">Read by {image.visionModel||'the vision model'}. Image descriptions can contain mistakes.</p><p>{image.context}</p></details>}
 </article>)}</div>;
}

export function ImageAttachButton({onFiles,disabled=false}:{onFiles:(files:File[])=>void|Promise<void>;disabled?:boolean}){
 const input=useRef<HTMLInputElement>(null);
 return <><input ref={input} className="image-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={disabled} aria-label="Choose images to attach" tabIndex={-1} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';if(files.length)void onFiles(files)}}/><button type="button" className="image-attach-button" aria-label="Attach images" title="Attach images · or paste a screenshot" disabled={disabled} onClick={()=>input.current?.click()}><ImagePlus size={18}/></button></>;
}
