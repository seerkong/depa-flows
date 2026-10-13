import {expect,test} from 'bun:test';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import type {AIAgentHostEffectPort,AIWorkflowRuntimeContext,FlowClosedValue,AIAgentEffectConfig} from 'ai-workflow-contract';
import {freezeAIWorkflowRunResourcesFromDirectory,projectFrozenAIAgentTaskBinding} from 'ai-workflow-logic/run-freeze';
import {createMaterializedAICtrlWorkflowControllerFromDirectory} from 'ai-ctrl-workflow-logic/filesystem';

for(const policy of ['shared','independent-per-generation'] as const)test(`native ctrl binder freezes ${policy} Agent context through actual iterations and filesystem reconstruction`,async()=>{
  const base=path.resolve('.tmp/agent-context-policy');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'ctrl-')),source=path.join(root,'source');await mkdir(source);
  try{
    await writeFile(path.join(source,'manifest.xnl'),`<AICtrlWorkflow #depa.flows.test.Workflow.Support apiVersion="depa.flows/v1" version="1" (<FlowContract #depa.flows.test.Workflow.Support>) [
<Until #loop {when="vfs://./code.ts#done" maxIterations=2 onExhausted="complete"} [
<Run #collect-request {src="vfs://./code.ts#invoke" config={agentDefinitionRef="resource://depa.flows.test.Agent.Support"}}>
<ExternalJob #hold {signalKind="original.hold" signalKey="iteration"}>
]><Return #result>]>`);
    await writeFile(path.join(source,'code.ts'),'export const sourceIdentity="frozen-agent-context-test";');
    const proof=projectFrozenAIAgentTaskBinding(await freezeAIWorkflowRunResourcesFromDirectory(path.join(import.meta.dir,'../../ai-workflow-logic/test/fixtures/HalfcodeAIAgentResourcePackage'),{workflowKind:'AICtrlWorkflow',workflowRef:'resource://depa.flows.test.Workflow.Support',nodeId:'collect-request',agentDefinitionRef:'resource://depa.flows.test.Agent.Support'}));
    const calls:{mode:string;generation:number|undefined;instanceId:string}[]=[];
    const effects:AIAgentHostEffectPort={async runAgent(request){const instanceId='original-actor-'+(calls.length+1);calls.push({mode:'new',generation:request.generation,instanceId});return {output:{value:'new full task'},instance:{authority:'original-owner',instanceId,instanceName:request.instanceName}}},async runTargetedAgent(request){calls.push({mode:'targeted',generation:request.generation,instanceId:request.instance.instanceId});return {output:{value:'next full task'},instance:request.instance}}};
    function create(admit=false){return createMaterializedAICtrlWorkflowControllerFromDirectory({storeRoot:root,instanceId:'original-instance',...(admit?{bundleDir:source,source:{revision:'r1',provenance:{authority:'resource-package',artifactRef:'resource://depa.flows.test.Workflow.Support'}}}:{}),checkpointConfig:{workflowAgentContexts:{'collect-request':{schemaVersion:'workflow.agent-context/v1',agentDefinitionRef:'resource://depa.flows.test.Agent.Support',sessionPolicy:policy}}},durableAI:{schemaVersion:'depa.ai-agent-state/v1',instancesById:{},instanceIdByName:{},invocationsByKey:{}},ai:{roots:{globalRoot:'vfs://global',workspaceRoot:'vfs://workspace'},effects:{async invoke(){throw Error('unexpected free effect')}},stateStore:{async loadRunState(){return undefined}}},agentEffects:effects,agentTaskProofs:{'collect-request':proof},importModule:async()=>({done:()=>false,invoke:(runtime:{ai:AIWorkflowRuntimeContext},input:FlowClosedValue,config:AIAgentEffectConfig)=>{if(!runtime.ai.tasks)throw Error('bound node tasks required');return runtime.ai.tasks.invoke(input,config)}})})}
    let status=await create(true).start('original-run',{input:{value:'original input'}});if(status.status!=='Waiting')throw Error('original native context did not wait: '+JSON.stringify(status));expect(status.status).toBe('Waiting');expect(calls).toHaveLength(1);
    await rm(source,{recursive:true});
    for(let iteration=0;iteration<2;iteration++){
      const wait=status.openWaitHandles[0];if(!wait)throw Error('original native wait required: '+JSON.stringify({iteration,status,calls}));
      status=await create().resume('original-run',{signalKind:wait.signalKind,signalKey:wait.signalKey,resumeToken:wait.resumeToken,outcome:'Success',payload:{value:'complete next task '+iteration}});
    }
    expect(status.status).toBe('Completed');expect(calls.map(call=>call.generation)).toEqual([0,1]);expect(calls.map(call=>call.mode)).toEqual(policy==='shared'?['new','targeted']:['new','new']);expect(new Set(calls.map(call=>call.instanceId)).size).toBe(policy==='shared'?1:2);
    expect((await create().start('original-run',{input:{value:'original input'}})).status).toBe('Completed');expect(calls).toHaveLength(2);
  }finally{await rm(root,{recursive:true,force:true})}
});
