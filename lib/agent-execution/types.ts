import type {Agent,AgentDefinition,AgentNode,Guardrail,Risk} from '../governance/types';

export type ExecutionStatus='Success'|'Failed'|'Blocked'|'Awaiting approval'|'Cancelled';
export type ExecutionTokenUsage={generation:number;policy:number};
export type ExecutionCheck={id:string;rule:string;stage:Guardrail['stage'];action:Guardrail['action'];violated:boolean;summary:string};
export type NodeExecution={nodeId:string;label:string;kind:AgentNode['kind'];status:ExecutionStatus|'Skipped';input:string;output:string;summary:string;at:string;duration:number;tokens:number;tokenUsage?:ExecutionTokenUsage;policyChecks?:ExecutionCheck[];cost:number;toolName?:string;toolMode?:'demo';model?:string;baseUrl?:string};
export type ExecutionPolicy={rule:string;severity:Risk;action:'Block'|'Require approval'|'Flag';context:string;nodeId?:string};
export type ExecutionRequest={agent:Agent;definition:AgentDefinition;globalPolicies?:{revision:number;rules:Guardrail[]};references?:{agent:Agent;definition:AgentDefinition}[];input:string;nodeId?:string};
export type ExecutionResult={id:string;agentId:string;configurationRevision:number;globalPolicyRevision?:number;mode:'agent'|'node';nodeId?:string;input:string;output:string;status:ExecutionStatus;at:string;duration:number;tokens:number;tokenUsage?:ExecutionTokenUsage;cost:number;costKnown:boolean;model:string;baseUrl?:string;nodes:NodeExecution[];policies:ExecutionPolicy[];warnings:string[]};
export type ExecutionEvent={type:'start';id:string;at:string}|{type:'node-start';nodeId:string;label:string}|{type:'node-result';node:NodeExecution}|{type:'complete';result:ExecutionResult}|{type:'error';message:string};
