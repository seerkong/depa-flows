import {expect,test} from 'bun:test';
import type {AIAgentProcessorRuntime,WorkflowDelegationEffectPort,WorkflowDelegationObservation,WorkflowDelegationRequest} from 'ai-workflow-contract';
import {bindWorkflowNodeTasks,bindWorkflowTaskDelegation,runAgent,runTargetedAgent} from 'ai-workflow-logic';
import {fixture,target} from './backflow-fixture';

const complete=(request:WorkflowDelegationRequest):WorkflowDelegationObservation=>({invocationKey:request.lineage.invocationKey,attempt:request.attempt,receiptId:'original-owner-receipt',status:'completed',target,output:request.delegation.task.input});
const config={agentDefinitionRef:'resource://draft'} as const;
function agentRuntime(runtime:ReturnType<Awaited<ReturnType<typeof fixture>>['runtime']>,called:()=>void):AIAgentProcessorRuntime {
  return {...runtime,effects:{
    async runAgent(request){called();return {output:request.input,instance:{authority:'eidolon',instanceId:'original-resource-agent',...(request.instanceName?{instanceName:request.instanceName}:{})}}},
    async runTargetedAgent(request){called();return {output:request.input,instance:request.instance}},
  }};
}

test('explicit node task invocation preserves the canonical resource Agent owner and receipt when no source overrides it',async()=>{
  let agentCalls=0,submits=0;
  const h=await fixture({verifyMaterials:async()=>{},submit:async request=>{submits++;return complete(request)},observe:async request=>complete(request)},[]);
  const task=bindWorkflowNodeTasks(agentRuntime(h.runtime(),()=>agentCalls++));
  const input={task:'本节点完整原任务'},options={...config,instanceName:'original-agent-name'};
  expect(await task.invoke(input,options)).toEqual(input);expect(await task.invoke(input,options)).toEqual(input);expect(agentCalls).toBe(1);expect(submits).toBe(0);
  const checkpoint=await h.read();if(checkpoint.profile.kind==='WorkCtrlFlow')throw Error('AI required');
  expect(checkpoint.profile.ai.invocationsByKey['draft#0']?.status).toBe('completed');expect(checkpoint.profile.ai.instancesById['original-resource-agent']?.instanceName).toBe('original-agent-name');
});

test('the same task entry consumes only the admitted delegation; strict legacy calls still reject source bypass',async()=>{
  let agentCalls=0,submits=0;
  const h=await fixture({verifyMaterials:async()=>{},submit:async request=>{submits++;return complete(request)},observe:async request=>complete(request)});
  const runtime=agentRuntime(h.runtime(),()=>agentCalls++),task=bindWorkflowNodeTasks(runtime,bindWorkflowTaskDelegation(h.runtime())),input={task:'本次完整新任务',materials:['frozen-role']};
  expect(await task.invoke(input,config)).toEqual(input);expect(await task.invoke(input,config)).toEqual(input);
  await expect(runAgent(runtime,input,config)).rejects.toThrow('explicit task source');
  await expect(runTargetedAgent(runtime,{byId:'original-resource-agent'},{kind:'ai.agent',payload:input},config)).rejects.toThrow('explicit task source');
  expect(agentCalls).toBe(0);expect(submits).toBe(1);
});

test('wrong frozen definitions, missing owners and ignored Agent effect options reject before any dispatch',async()=>{
  let calls=0;
  const h=await fixture({verifyMaterials:async()=>{},submit:async request=>{calls++;return complete(request)},observe:async request=>{calls++;return complete(request)}}),runtime=agentRuntime(h.runtime(),()=>calls++),task=bindWorkflowNodeTasks(runtime,bindWorkflowTaskDelegation(h.runtime()));
  await expect(task.invoke({}, {agentDefinitionRef:'resource://another-agent'})).rejects.toThrow();
  await expect(bindWorkflowNodeTasks(runtime).invoke({},config)).rejects.toThrow('owner is unavailable');
  for(const extra of [{instanceName:'ignored-name'},{materialRefs:['ignored-material']},{effectPolicy:{unknown:true}}])await expect(task.invoke({},{...config,...extra})).rejects.toThrow('cannot be ignored');
  expect(calls).toBe(0);expect((await h.read()).version).toBe(0);
});

test('unknown delegated task invocation only observes its original receipt and never falls back to a resource Agent',async()=>{
  let submits=0,observes=0,agentCalls=0;
  const port:WorkflowDelegationEffectPort={verifyMaterials:async()=>{},submit:async()=>{submits++;throw Error('lost original acknowledgement')},observe:async request=>{observes++;return complete(request)}};
  const h=await fixture(port),task=bindWorkflowNodeTasks(agentRuntime(h.runtime(),()=>agentCalls++),bindWorkflowTaskDelegation(h.runtime())),input={task:'原未知执行'};
  await expect(task.invoke(input,config)).rejects.toThrow('observe the original invocation');
  expect(await task.invoke(input,config)).toEqual(input);expect(submits).toBe(1);expect(observes).toBe(1);expect(agentCalls).toBe(0);
});
