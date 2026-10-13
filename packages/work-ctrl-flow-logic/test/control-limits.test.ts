import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadFlowBundleFromSources, FLOW_STATE_KEY,flowStateOf, type FlowExecutionState } from 'instant-ctrl-flow-logic/browser';
import { WorkCtrlFlowEngine,WaitNodeHandler } from '../src/engine.js';
import { FileWorkCtrlFlowStore,InMemoryWorkCtrlFlowStore } from '../src/stores.js';

test('an opened wait projects its real loop generation without allocating another invocation',async()=>{
  const loaded=loadFlowBundleFromSources({'manifest.xnl':`<WorkCtrlFlow #test.WaitIdentity apiVersion="depa.flows/v1" version="1" (<FlowContract #test.WaitIdentity>) [
<Until #round {when="vfs://./code.ts#more" maxIterations=2 onExhausted="complete"} [<ExternalJob #review {signalKind="human.review"}>]>
]>`});
  const identities:{key:string;generation:number;visit:string}[]=[];
  const engine=new WorkCtrlFlowEngine({definition:{spec:loaded.spec!,resolveCode:()=>()=>false},store:new InMemoryWorkCtrlFlowStore(),extraHandlers:controller=>({
    'wf.ExternalJob':new WaitNodeHandler('external-job',controller,async(ctx,handle)=>{
      const native=controller(),first=native.runtimeIdentityForInvocation(handle.nodeKey,handle.invocationKey,flowStateOf(ctx));
      expect(native.runtimeIdentityForInvocation(handle.nodeKey,handle.invocationKey,flowStateOf(ctx))).toEqual(first);
      expect(native.invocationKeyFor(handle.nodeKey)).toBe(handle.invocationKey.replace(/#(\d+)$/,(_match,index)=>'#'+(Number(index)+1)));
      identities.push({key:handle.invocationKey,generation:first.generation,visit:first.visit});
    }),
  })});
  let outcome=await engine.start('real-wait');
  for(let round=0;round<2;round++){
    expect(outcome.status).toBe('Waiting');const wait=outcome.openWaitHandles[0]!;
    outcome=await engine.resume('real-wait',{signalKind:wait.signalKind,signalKey:wait.signalKey,resumeToken:wait.resumeToken,payload:{round}});
  }
  expect(outcome.status).toBe('Completed');expect(identities.map(identity=>identity.generation)).toEqual([0,1]);
  expect(new Set(identities.map(identity=>identity.key)).size).toBe(2);expect(new Set(identities.map(identity=>identity.visit)).size).toBe(2);
});

test('paused lanes hold slots; restart freezes expansion and preserves ordered outputs and stage barrier', async () => {
  const loaded = loadFlowBundleFromSources({ 'manifest.xnl': `<WorkCtrlFlow #test.FrozenMap apiVersion="depa.flows/v1" version="1" (<FlowContract #test.FrozenMap>) [
    <ForEach #map {when="vfs://./code.ts#items" maxItems=5 concurrency=2} [
      <Run #submit {src="vfs://./code.ts#submit"}>
      <ExternalJob #wait {signalKind="finished"}>
    ]>
    <Run #barrier {src="vfs://./code.ts#barrier"}>
  ]>` });
  expect(loaded.diagnostics).toEqual([]);
  const base = path.resolve(import.meta.dir, '../../../.tmp/control-limits');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, 'restart-'));
  let selections = 0, barriers = 0;
  const submits: unknown[] = [];
  const make = () => new WorkCtrlFlowEngine({
    definition: { spec: loaded.spec!, resolveCode: ({ reference }) => (_runtime, input) => {
      if (reference.endsWith('#items')) { selections++; return [0, 1, 2, 3, 4]; }
      if (reference.endsWith('#submit')) submits.push(input);
      if (reference.endsWith('#barrier')) barriers++;
      return input;
    } },
    store: new FileWorkCtrlFlowStore(directory),
  });
  let outcome = await make().start('bounded');
  expect(submits).toEqual([0, 1]);
  expect(outcome.openWaitHandles).toHaveLength(2);
  expect(barriers).toBe(0);
  for (let i = 0; i < 5; i++) {
    const handle = outcome.openWaitHandles[0];
    outcome = await make().resume('bounded', { signalKind: handle.signalKind, signalKey: handle.signalKey, resumeToken: handle.resumeToken, payload: Number(handle.invocationKey.match(/item:(\d+)/)?.[1]) });
    expect(outcome.openWaitHandles.length).toBeLessThanOrEqual(2);
    expect(selections).toBe(1);
    if (i < 4) expect(barriers).toBe(0);
  }
  expect(outcome.status).toBe('Completed');
  expect(submits).toEqual([0, 1, 2, 3, 4]);
  expect(barriers).toBe(1);
  expect((outcome.vars[FLOW_STATE_KEY] as FlowExecutionState).current).toEqual([0, 1, 2, 3, 4]);
  const snapshot = await new FileWorkCtrlFlowStore(directory).load('bounded');
  expect(snapshot?.orchestration.composites['map#0'].expansion).toEqual({ itemCount: 5, maxItems: 5, concurrency: 2 });
});

test('ForEach rejects overflow before any item submission and never truncates an unbounded traversal', async () => {
  for (const limited of [true, false]) {
    const loaded = loadFlowBundleFromSources({ 'manifest.xnl': `<WorkCtrlFlow #test.FullEach apiVersion="depa.flows/v1" version="1" (<FlowContract #test.FullEach>) [
      <ForEach #each {when="vfs://./code.ts#items" ${limited ? 'maxItems=2' : ''}} [<Run #work {src="vfs://./code.ts#work"}>]>
    ]>` });
    const base = path.resolve(import.meta.dir, '../../../.tmp/control-limits'); mkdirSync(base, { recursive: true });
    let submissions = 0;
    const result = await new WorkCtrlFlowEngine({ definition: { spec: loaded.spec!, resolveCode: ({ reference }) => (_runtime, input) => {
      if (reference.endsWith('#items')) return [1, 2, 3, 4];
      submissions++; return input;
    } }, store: new FileWorkCtrlFlowStore(mkdtempSync(path.join(base, 'overflow-'))) }).start('full');
    expect(result.status).toBe(limited ? 'Failed' : 'Completed');
    expect(submissions).toBe(limited ? 0 : 4);
  }
});
