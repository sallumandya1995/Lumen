'use client';
import {useSyncExternalStore} from 'react';

const KEY='azure-workspace-user';
const EVENT='azure-workspace-user-change';
let current='u-owner';
let initialized=false;
function read(){
 if(typeof window==='undefined')return 'u-owner';
 if(!initialized){initialized=true;try{current=localStorage.getItem(KEY)||'u-owner'}catch{}}
 return current;
}
function subscribe(notify:()=>void){
 const storage=(e:StorageEvent)=>{if(e.key===KEY){current=e.newValue||'u-owner';notify()}};
 window.addEventListener(EVENT,notify);window.addEventListener('storage',storage);
 return()=>{window.removeEventListener(EVENT,notify);window.removeEventListener('storage',storage)};
}
function setUser(id:string){current=id;initialized=true;try{localStorage.setItem(KEY,id)}catch{}window.dispatchEvent(new Event(EVENT))}
/** Shared demo identity across Agent Studio and Agent Governance; real API identity is server-owned. */
export function useWorkspaceUser():[string,(id:string)=>void]{
 return [useSyncExternalStore(subscribe,read,()=> 'u-owner'),setUser];
}
