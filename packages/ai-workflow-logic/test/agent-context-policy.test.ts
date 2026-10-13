import {expect,test} from 'bun:test';
import type {AIAgentHostEffectPort,AIAgentProcessorRuntime} from 'ai-workflow-contract';
import {bindWorkflowNodeTasks,runAgent,runTargetedAgent} from 'ai-workflow-logic';
import {fixture} from './backflow-fixture';

const config={agentDefinitionRef:'resource://draft'} as const;
async function harness(policy:'authored'|'shared'|'independent-per-generation',definitionRef:string=config.agentDefinitionRef){
  const h=await fixture({verifyMaterials:async()=>{},submit:async()=>{throw Error('unexpected Task owner')},observe:async()=>{throw Error('unexpected Task owner')}},[],{workflowAgentContexts:{draft:{schemaVersion:'workflow.agent-context/v1',agentDefinitionRef:definitionRef,sessionPolicy:policy}}});
  const calls:{kind:'new'|'targeted';input:unknown;instanceId:string;generation:number|undefined}[]=[];
  const effects:AIAgentHostEffectPort={
    async runAgent(request){const instanceId='actual-instance-'+(calls.length+1);calls.push({kind:'new',input:request.input,instanceId,generation:request.generation});return {output:request.input,instance:{authority:'original-owner',instanceId,instanceName:request.instanceName}}},
    async runTargetedAgent(request){calls.push({kind:'targeted',input:request.input,instanceId:request.instance.instanceId,generation:request.generation});return {output:request.input,instance:request.instance}},
  };
  function runtime(generation:number,scope=''):AIAgentProcessorRuntime{
    return {...h.runtime(),invocationKey:`${scope}/draft#${generation}`,nodeContext:{generation,scope},effects};
  }
  return {...h,calls,runtime};
}

test('shared frozen Agent policy sends each complete task to one canonical instance across generations and replay',async()=>{
  const h=await harness('shared'),first={task:'本代完整任务一'},second={task:'下一代完整任务二'};
  const one=await runAgent(h.runtime(0),first,config);expect(one.output).toEqual(first);
  expect(await bindWorkflowNodeTasks(h.runtime(1)).invoke(second,config)).toEqual(second);
  expect(await bindWorkflowNodeTasks(h.runtime(1)).invoke(second,config)).toEqual(second);
  expect(h.calls).toEqual([{kind:'new',input:first,instanceId:'actual-instance-1',generation:0},{kind:'targeted',input:second,instanceId:'actual-instance-1',generation:1}]);
  const checkpoint=await h.read();if(checkpoint.profile.kind==='WorkCtrlFlow')throw Error('AI required');expect(Object.keys(checkpoint.profile.ai.instancesById)).toHaveLength(1);
  await expect(runTargetedAgent(h.runtime(2),{byId:one.instance.instanceId},{kind:'ai.agent',payload:{}},{agentDefinitionRef:'resource://different'})).rejects.toThrow();expect(h.calls).toHaveLength(2);
});

test('independent frozen generations and native lane scopes cannot reuse an older context',async()=>{
  const h=await harness('independent-per-generation');const first=await runAgent(h.runtime(0),{task:'开发'},config);
  await expect(runTargetedAgent(h.runtime(1),{byId:first.instance.instanceId},{kind:'ai.agent',payload:{task:'独立评审'}},config)).rejects.toThrow('original instance for this frozen node generation and scope');
  await bindWorkflowNodeTasks(h.runtime(1)).invoke({task:'独立评审'},config);
  await bindWorkflowNodeTasks(h.runtime(1,'map/item-A')).invoke({task:'分项A'},config);
  await bindWorkflowNodeTasks(h.runtime(1,'map/item-B')).invoke({task:'分项B'},config);
  expect(h.calls.map(call=>call.kind)).toEqual(['new','new','new','new']);expect(new Set(h.calls.map(call=>call.instanceId)).size).toBe(4);
  const checkpoint=await h.read();if(checkpoint.profile.kind==='WorkCtrlFlow')throw Error('AI required');expect(new Set(Object.values(checkpoint.profile.ai.instancesById).map(instance=>instance.instanceName)).size).toBe(4);
});

test('a frozen Agent context rejects missing native identity, name overrides and changed declarations before dispatch',async()=>{
  const h=await harness('independent-per-generation'),runtime=h.runtime(0);
  await expect(runAgent({...runtime,generation:undefined,nodeContext:undefined},{},config)).rejects.toThrow('actual native generation and scope');
  await expect(runAgent(runtime,{},{...config,instanceName:'bypass-frozen-policy'})).rejects.toThrow('frozen node context identity');
  const before=await h.read();await expect(h.store.commit({expectedVersion:before.version,checkpoint:{...before,version:before.version+1,config:{}}})).rejects.toThrow('immutable config');
  const invalid=await harness('shared','resource://foreign');await expect(runAgent(invalid.runtime(0),{},config)).rejects.toThrow('exact node task definition');expect(h.calls).toEqual([]);expect(invalid.calls).toEqual([]);
});

test('authored context preserves exact names and explicit targeted calls while opting into actual node generations',async()=>{
  const h=await harness('authored'),first=await runAgent(h.runtime(0),{task:'原作者命名任务'},{...config,instanceName:'original-author-name'});
  expect(first.instance.instanceName).toBe('original-author-name');
  const invocation={kind:'ai.agent' as const,payload:{task:'原作者显式续作'}};
  const second=await runTargetedAgent(h.runtime(1),{byName:'original-author-name'},invocation,config);
  expect(second.instance.instanceId).toBe(first.instance.instanceId);
  expect(await runTargetedAgent(h.runtime(1),{byName:'original-author-name'},invocation,config)).toEqual(second);
  expect(h.calls.map(call=>[call.kind,call.generation])).toEqual([['new',0],['targeted',1]]);
});
