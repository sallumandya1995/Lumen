import type {ImageAttachment} from '../lib/image-attachments';
import type {TokenProbability} from './token-probabilities';

export type ChatMessage={role:'user'|'assistant';content:string;images?:ImageAttachment[];logprobs?:TokenProbability[];model?:string;durationMs?:number;parameters?:Record<string,number>};
export type ChatSnapshot={model:string;settings:Record<string,string>;messages:ChatMessage[]};
export type SharedChatPrompt={text:string;images:ImageAttachment[]};
export type ChatPaneHandle={
 snapshot:()=>ChatSnapshot;
 validatePrompt:(prompt:SharedChatPrompt)=>string|null;
 sendPrompt:(prompt:SharedChatPrompt,options?:{clearComposer?:boolean})=>Promise<void>;
 reset:()=>void;
 stop:()=>void;
 focus:()=>void;
 showError:(message:string)=>void;
};
export type ChatPaneProps={
 id:number;
 seed?:ChatSnapshot;
 comparison:boolean;
 workspaceLocked:boolean;
 anyBusy:boolean;
 onBusyChange:(id:number,busy:boolean)=>void;
 onAdd:(sourceId:number)=>void;
 onClose?:()=>void;
 canAdd:boolean;
 onSendAll?:(sourceId:number,prompt:SharedChatPrompt)=>Promise<void>;
 onNavigate:(mode:'guided'|'governance')=>void;
};
