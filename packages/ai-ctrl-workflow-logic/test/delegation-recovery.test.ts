import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { loadFlowBundleFromSources } from 'instant-ctrl-flow-logic';
import { WorkCtrlFlowEngine, FileWorkCtrlFlowStore } from 'work-ctrl-flow-logic';
import { WorkflowDelegationSuspendedError,normalizeFlowClosedObject } from 'ai-workflow-logic';
import { createAICtrlWorkflowDelegationHandlers } from '../src/delegation.js';
import fs from 'node:fs';
import {createCanonicalMaterializedWorkCtrlFlowEngine,FilesystemFlowRunCheckpointStore} from 'ai-workflow-logic/checkpoint-filesystem';

test('repeated pending owner observations consume each original wakeup and create a new wait without a new submission',async()=>{
  const loaded=loadFlowBundleFromSources({'manifest.xnl':`<WorkCtrlFlow #test.PendingObservations apiVersion="depa.flows/v1" version="1" (<FlowContract #test.PendingObservations>) [
    <Run #agent {src="vfs://./code.ts#agent"}>
    <Return #done>
  ]>`});
  expect(loaded.diagnostics).toEqual([]);
  const base=path.resolve(import.meta.dir,'../../../.tmp/delegation-recovery');mkdirSync(base,{recursive:true});
  const directory=mkdtempSync(path.join(base,'pending-'));let attempts=0;
  const resolveCode=()=>async(runtime:Record<string,unknown>)=>{attempts++;if(attempts<3)throw new WorkflowDelegationSuspendedError(String(runtime.callKey),'busy');return {complete:true}};
  const bindNodeRuntime=(runtime:Record<string,unknown>,identity:{invocationKey:string})=>({...runtime,callKey:identity.invocationKey});
  const make=()=>new WorkCtrlFlowEngine({definition:{spec:loaded.spec!,resolveCode},store:new FileWorkCtrlFlowStore(directory),bindNodeRuntime,extraHandlers:controller=>createAICtrlWorkflowDelegationHandlers(loaded.spec!,resolveCode,bindNodeRuntime,controller)});
  let result=await make().start('pending',{input:{}});expect(result.status).toBe('Waiting');
  const original=result.openWaitHandles[0]!;
  result=await make().resume('pending',{signalKind:original.signalKind,signalKey:original.signalKey,resumeToken:original.resumeToken,payload:null});
  expect(result.status).toBe('Waiting');expect(result.openWaitHandles[0]!.resumeToken).not.toBe(original.resumeToken);
  const next=result.openWaitHandles[0]!;
  result=await make().resume('pending',{signalKind:next.signalKind,signalKey:next.signalKey,resumeToken:next.resumeToken,payload:null});
  expect(result.status).toBe('Completed');expect(attempts).toBe(3);
});

test('canonical file checkpoints preserve consumed delegation wakeups while another owner observation remains pending',async()=>{
  const base=path.resolve(import.meta.dir,'../../../.tmp/delegation-recovery');mkdirSync(base,{recursive:true});
  const root=mkdtempSync(path.join(base,'canonical-pending-')),source=path.join(root,'source');mkdirSync(source);
  const manifest=`<WorkCtrlFlow #test.CanonicalPending apiVersion="depa.flows/v1" version="1" (<FlowContract #test.CanonicalPending>) [
    <Run #agent {src="vfs://./code.ts#agent"}>
    <Return #done>
  ]>`;
  fs.writeFileSync(path.join(source,'manifest.xnl'),manifest);fs.writeFileSync(path.join(source,'code.ts'),'export const agent=(runtime)=>runtime.invoke();');
  const loaded=loadFlowBundleFromSources({'manifest.xnl':manifest});expect(loaded.diagnostics).toEqual([]);
  let calls=0;
  const resolveCode=()=>async()=>{calls++;if(calls<3)throw new WorkflowDelegationSuspendedError('agent#1','busy');return {completed:true}};
  const make=(first=false)=>createCanonicalMaterializedWorkCtrlFlowEngine({storeRoot:root,instanceId:'instance',checkpointConfig:{},
    ...(first?{bundleDir:source,source:{revision:'r1',provenance:{authority:'resource-package',artifactRef:'resource://test.CanonicalPending'}}}:{}),
    runtime:{invoke:resolveCode()},extraHandlers:controller=>createAICtrlWorkflowDelegationHandlers(loaded.spec!,resolveCode,undefined,controller)});
  try{
    let result=await make(true).start('run',{input:{}});
    expect(result.status).toBe('Waiting');
    const owner=new FilesystemFlowRunCheckpointStore({storeRoot:root}),before=await owner.load({instanceId:'instance',runId:'run'});
    if(!before||before.profile.kind!=='WorkCtrlFlow')throw Error('canonical ctrl required');
    const original=before.profile.snapshot;
    const forgedWaits={...normalizeFlowClosedObject(original.waitResults),'agent:delegation:999#0':{result:'Success'}};
    await expect(owner.commit({expectedVersion:before.version,checkpoint:{...before,version:before.version+1,nodeSidecars:{...before.nodeSidecars,waitResults:forgedWaits},profile:{...before.profile,snapshot:{...original,waitResults:forgedWaits}}}})).rejects.toThrow('not admitted');
    const handles=original.openWaitHandles;
    if(!Array.isArray(handles))throw Error('native wait required');
    const changed=handles.map(handle=>({...handle,signalKey:'foreign#0'}));
    await expect(owner.commit({expectedVersion:before.version,checkpoint:{...before,version:before.version+1,controllerSidecars:{...before.controllerSidecars,openWaitHandles:changed},profile:{...before.profile,snapshot:{...original,openWaitHandles:changed}}}})).rejects.toThrow('identity');
    expect((await owner.load({instanceId:'instance',runId:'run'}))?.version).toBe(before.version);
    for(let index=0;index<2;index++){
      const wait=result.openWaitHandles[0]!;
      result=await make().resume('run',{signalKind:wait.signalKind,signalKey:wait.signalKey,resumeToken:wait.resumeToken,payload:null});
    }
    expect(result.status).toBe('Completed');expect(calls).toBe(3);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('different Until iterations retain different delegation wait identities and original input',async()=>{
  const manifest=`<WorkCtrlFlow #test.IterationWaits apiVersion="depa.flows/v1" version="1" (<FlowContract #test.IterationWaits>) [
    <Until #loop {when="vfs://./code.ts#done" maxIterations=2} [<Run #agent {src="vfs://./code.ts#agent"}>]>
    <Return #done>
  ]>`;
  const loaded=loadFlowBundleFromSources({'manifest.xnl':manifest});expect(loaded.diagnostics).toEqual([]);
  const base=path.resolve(import.meta.dir,'../../../.tmp/delegation-recovery');mkdirSync(base,{recursive:true});
  const root=mkdtempSync(path.join(base,'iteration-waits-')),source=path.join(root,'source');mkdirSync(source);
  fs.writeFileSync(path.join(source,'manifest.xnl'),manifest);fs.writeFileSync(path.join(source,'code.ts'),'export const agent=(runtime,input)=>runtime.invoke(input.value);export const done=(_runtime,input)=>input.value>=2;');
  const submits:number[]=[],visits=new Map<number,number>();
  const invoke=(value:number)=>{const prior=visits.get(value)??0;visits.set(value,prior+1);if(prior===0){submits.push(value);throw new WorkflowDelegationSuspendedError(`agent#${value}`,'unknown')}return {value:value+1}};
  const resolveCode=({reference}:{reference:string})=>(_runtime:unknown,input:unknown)=>{
    if(!input||typeof input!=='object'||!('value' in input)||typeof input.value!=='number')throw Error('original loop input required');
    return reference.endsWith('#done')?input.value>=2:invoke(input.value);
  };
  const make=(first=false)=>createCanonicalMaterializedWorkCtrlFlowEngine({storeRoot:root,instanceId:'instance',checkpointConfig:{},
    ...(first?{bundleDir:source,source:{revision:'r1',provenance:{authority:'resource-package',artifactRef:'resource://test.IterationWaits'}}}:{}),
    runtime:{invoke},extraHandlers:controller=>createAICtrlWorkflowDelegationHandlers(loaded.spec!,resolveCode,undefined,controller)});
  try{
    let result=await make(true).start('run',{input:{value:0}});const first=result.openWaitHandles[0]!;
    result=await make().resume('run',{signalKind:first.signalKind,signalKey:first.signalKey,resumeToken:first.resumeToken});
    expect(result.status).toBe('Waiting');const second=result.openWaitHandles[0]!;expect(second.invocationKey).not.toBe(first.invocationKey);expect(second.resumeToken).not.toBe(first.resumeToken);
    result=await make().resume('run',{signalKind:second.signalKind,signalKey:second.signalKey,resumeToken:second.resumeToken});
    expect(result.status).toBe('Completed');expect(submits).toEqual([0,1]);
    const stored=await new FilesystemFlowRunCheckpointStore({storeRoot:root}).load({instanceId:'instance',runId:'run'});
    if(stored?.profile.kind!=='WorkCtrlFlow')throw Error('original ctrl required');
    expect(stored.profile.snapshot.closedWaitHandles).toHaveLength(2);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('loop context follows the actual iteration even when predecessor and reviewer branch visit counts differ', async () => {
  for (const draftEveryRound of [true, false]) {
    const loaded = loadFlowBundleFromSources({ 'manifest.xnl': `<WorkCtrlFlow #test.LoopContext apiVersion="depa.flows/v1" version="1" (<FlowContract #test.LoopContext>) [
      <Until #loop {when="vfs://./code.ts#done" maxIterations=3} [
        <If #draft-choice (<Branches [<Branch #draft-when {when="vfs://./code.ts#draftWhen"} [<Run #draft {src="vfs://./code.ts#draft"}>]>]>)>
        <If #review-choice (<Branches [<Branch #review-when {when="vfs://./code.ts#reviewWhen"} [<Run #review {src="vfs://./code.ts#review"}>]>]>)>
        <Run #advance {src="vfs://./code.ts#advance"}>
      ]>
    ]>` });
    expect(loaded.diagnostics).toEqual([]);
    const identities: { nodeId: string; invocationKey: string; visit?: string; generation?: number }[] = [];
    const base = path.resolve(import.meta.dir, '../../../.tmp/delegation-recovery'); mkdirSync(base, { recursive: true });
    const result = await new WorkCtrlFlowEngine({
      definition: { spec: loaded.spec!, resolveCode: ({ reference }) => (_runtime, input) => {
        const iteration = typeof input === 'object' && input !== null && 'value' in input ? Number(input.value) : Number(input);
        if (reference.endsWith('#done')) return iteration >= 2;
        if (reference.endsWith('#draftWhen')) return draftEveryRound || iteration === 0;
        if (reference.endsWith('#reviewWhen')) return iteration === 1;
        if (reference.endsWith('#advance')) return { value: iteration + 1 };
        return input;
      } },
      store: new FileWorkCtrlFlowStore(mkdtempSync(path.join(base, 'loop-context-'))),
      bindNodeRuntime: (runtime, identity) => { identities.push(identity); return runtime; },
    }).start('loop-context', { input: { value: 0 } });
    expect(result.status).toBe('Completed');
    const drafts = identities.filter(item => item.nodeId === 'draft');
    const reviews = identities.filter(item => item.nodeId === 'review');
    expect(drafts).toHaveLength(draftEveryRound ? 2 : 1);
    expect(reviews).toHaveLength(1);
    expect(drafts.at(-1)?.invocationKey).not.toBe(reviews[0].invocationKey);
    if (draftEveryRound) {
      expect(drafts.at(-1)?.visit).toBe(reviews[0].visit);
      expect(drafts.at(-1)?.generation).toBe(reviews[0].generation);
    } else {
      expect(drafts[0].visit).not.toBe(reviews[0].visit);
      expect(drafts[0].generation).not.toBe(reviews[0].generation);
    }
  }
});

test('unknown delegation in a later loop visit observes the same original call after engine reconstruction', async () => {
  const loaded = loadFlowBundleFromSources({ 'manifest.xnl': `<WorkCtrlFlow #test.DelegationReplay apiVersion="depa.flows/v1" version="1" (<FlowContract #test.DelegationReplay>) [
    <Until #loop {when="vfs://./code.ts#done" maxIterations=3} [<Run #agent {src="vfs://./code.ts#agent"}>]>
  ]>` });
  expect(loaded.diagnostics).toEqual([]);
  const base = path.resolve(import.meta.dir, '../../../.tmp/delegation-recovery');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, 'original-'));
  const submitted = new Set<string>(); let observations = 0;
  const resolveCode = ({ reference }: { reference: string }) => (runtime: Record<string, unknown>, input: unknown) => {
    if (reference.endsWith('#done')) return Number(input) >= 2;
    const key = String(runtime.callKey);
    if (!submitted.has(key)) {
      submitted.add(key);
      if (submitted.size > 1) throw new WorkflowDelegationSuspendedError(key, 'unknown');
      return 1;
    }
    observations++;
    return 2;
  };
  const bindNodeRuntime = (runtime: Record<string, unknown>, identity: { invocationKey: string }) => ({ ...runtime, callKey: identity.invocationKey });
  const make = () => new WorkCtrlFlowEngine({ definition: { spec: loaded.spec!, resolveCode }, store: new FileWorkCtrlFlowStore(directory), bindNodeRuntime,
    extraHandlers: controller => createAICtrlWorkflowDelegationHandlers(loaded.spec!, resolveCode, bindNodeRuntime, controller),
  });
  const paused = await make().start('later-visit', { input: { value: 0 } });
  expect(paused.status).toBe('Waiting');
  expect(submitted.size).toBe(2);
  const handle = paused.openWaitHandles[0];
  const resumed = await make().resume('later-visit', { signalKind: handle.signalKind, signalKey: handle.signalKey, resumeToken: handle.resumeToken });
  expect(submitted.size).toBe(2);
  expect(observations).toBe(1);
  expect(resumed.status).toBe('Completed');
});

test('finishing one Map delegation preserves the other item original wait and token', async () => {
  const loaded = loadFlowBundleFromSources({ 'manifest.xnl': `<WorkCtrlFlow #test.ItemIsolation apiVersion="depa.flows/v1" version="1" (<FlowContract #test.ItemIsolation>) [
    <ForEach #map {when="vfs://./code.ts#items" concurrency=2 maxItems=2} [<Run #agent {src="vfs://./code.ts#agent"}>]>
  ]>` });
  expect(loaded.diagnostics).toEqual([]);
  const base = path.resolve(import.meta.dir, '../../../.tmp/delegation-recovery'); mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, 'item-'));
  const submitted = new Set<string>(), completed = new Set<string>();
  const resolveCode = ({ reference }: { reference: string }) => (runtime: Record<string, unknown>, input: unknown) => {
    if (reference.endsWith('#items')) return [1, 2];
    const key = String(runtime.callKey); submitted.add(key);
    if (!completed.has(key)) throw new WorkflowDelegationSuspendedError(key, 'unknown');
    return input;
  };
  const bindNodeRuntime = (runtime: Record<string, unknown>, identity: { invocationKey: string }) => ({ ...runtime, callKey: identity.invocationKey });
  const make = () => new WorkCtrlFlowEngine({ definition: { spec: loaded.spec!, resolveCode }, store: new FileWorkCtrlFlowStore(directory), bindNodeRuntime,
    extraHandlers: controller => createAICtrlWorkflowDelegationHandlers(loaded.spec!, resolveCode, bindNodeRuntime, controller),
  });
  const first = await make().start('items');
  expect(first.openWaitHandles).toHaveLength(2);
  const [one, two] = first.openWaitHandles;
  const keyOf = (handle: typeof one) => {
    const relation = handle.metadata?.workflowDelegation;
    if (!relation || typeof relation !== 'object' || !('invocationKey' in relation) || typeof relation.invocationKey !== 'string') throw Error('original owner invocation missing');
    return relation.invocationKey;
  };
  completed.add(keyOf(one));
  const resume = (handle: typeof one) => make().resume('items', { signalKind: handle.signalKind, signalKey: handle.signalKey, resumeToken: handle.resumeToken });
  const middle = await resume(one);
  expect(middle.status).toBe('Waiting');
  expect(middle.openWaitHandles).toEqual([two]);
  expect(submitted.size).toBe(2);
  completed.add(keyOf(two));
  expect((await resume(two)).status).toBe('Completed');
  expect(submitted.size).toBe(2);
});
