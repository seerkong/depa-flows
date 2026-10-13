import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { createCanonicalMaterializedWorkCtrlFlowEngine, FilesystemFlowRunCheckpointStore } from 'ai-workflow-logic/checkpoint-filesystem';

test('canonical checkpoints keep compiled Until and fallback actions with their exact frozen owners across restart', async () => {
  const base = path.resolve(import.meta.dir, '../../../.tmp/compiled-control-owner'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'isolated-')), source = path.join(root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'manifest.xnl'), `<WorkCtrlFlow #test.CompiledOwners apiVersion="depa.flows/v1" version="1" (<FlowContract #test.CompiledOwners>) [
    <Fallback #strategy (<Strategies []>) [<Strategy #primary [
      <Until #loop {when="vfs://./code.ts#done" maxIterations=3} [
        <If #choose (<Branches [<Branch #initial {when="vfs://./code.ts#initial"} [<Run #first {src="vfs://./code.ts#work"}>]><Otherwise [<Run #later {src="vfs://./code.ts#work"}>]>]>)>
        <ExternalJob #hold {signalKind="continue"}>
      ]>
    ]>]>
    <Return #out>
  ]>`);
  fs.writeFileSync(path.join(source, 'code.ts'), `export const done = (_runtime,input) => input.value >= 2;
    export const initial = (_runtime,input) => input.value === 0;
    export const work = (runtime,input) => { runtime.submitted(input.value); return {value:input.value+1}; };`);
  const submitted: number[] = [];
  const make = (first = false) => createCanonicalMaterializedWorkCtrlFlowEngine({ storeRoot: root, instanceId: 'instance', checkpointConfig: {}, runtime: { submitted: (value: number) => submitted.push(value) },
    ...(first ? { bundleDir: source, source: { revision: 'frozen-r1', provenance: { authority: 'resource-package', artifactRef: 'resource://test.CompiledOwners' } } } : {}) });
  try {
    let result = await make(true).start('run', { input: { value: 0 } });
    expect(result.status).toBe('Waiting'); expect(submitted).toEqual([0]);
    const store = new FilesystemFlowRunCheckpointStore({ storeRoot: root }), waiting = await store.load({ instanceId: 'instance', runId: 'run' });
    if (!waiting || waiting.profile.kind !== 'WorkCtrlFlow') throw Error('original canonical checkpoint required');
    const nodeResults = { ...(waiting.profile.snapshot.nodeResults as Record<string, string>), 'loop.__invented#0': 'Success' };
    const forged = { ...waiting, version: waiting.version + 1, nodeSidecars: { ...waiting.nodeSidecars, nodeResults },
      profile: { ...waiting.profile, snapshot: { ...waiting.profile.snapshot, nodeResults } } };
    await expect(store.commit({ expectedVersion: waiting.version, checkpoint: forged })).rejects.toThrow('not admitted');
    expect((await store.load({ instanceId: 'instance', runId: 'run' }))?.version).toBe(waiting.version);
    for (const value of [1, 2]) {
      const wait = result.openWaitHandles[0]!;
      result = await make().resume('run', { signalKind: wait.signalKind, signalKey: wait.signalKey, resumeToken: wait.resumeToken, payload: { value } });
      if (result.status === 'Failed') throw Error(JSON.stringify(result.vars));
    }
    expect(result.status).toBe('Completed'); expect(submitted).toEqual([0, 1]);
    const stored = await store.load({ instanceId: 'instance', runId: 'run' });
    expect(stored?.profile.kind).toBe('WorkCtrlFlow');
    const headFile = path.join(root, 'instances/instance/runs/run/checkpoint.json'), bytes = fs.readFileSync(headFile, 'utf8'), head = JSON.parse(bytes);
    expect(head.control.profile.definitionInvocationOwners['loop.__check.initial']).toBe('loop');
    expect(head.control.profile.definitionInvocationOwners['primary.__start']).toBe('strategy');
    head.control.profile.definitionInvocationOwners['loop.__check.initial'] = 'out';
    fs.writeFileSync(headFile, JSON.stringify(head));
    await expect(store.load({ instanceId: 'instance', runId: 'run' })).rejects.toThrow('frozen compiled definition');
    fs.writeFileSync(headFile, bytes);
    expect((await store.load({ instanceId: 'instance', runId: 'run' }))?.version).toBe(stored?.version);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('canonical failure keeps engine diagnostics while non-data business outputs remain rejected', async () => {
  const base = path.resolve(import.meta.dir, '../../../.tmp/compiled-control-owner'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'fault-')), source = path.join(root, 'source'); fs.mkdirSync(source);
  try {
    let getterCalls=0;
    for (const id of ['fault','business','getter']) {
      const invalidBusiness=id!=='fault';
      fs.writeFileSync(path.join(source, 'manifest.xnl'), `<WorkCtrlFlow #test.Fault apiVersion="depa.flows/v1" version="1" (<FlowContract #test.Fault>) [<Run #work {src="vfs://./${id}.ts#work"}><Return #out>]>`);
      fs.writeFileSync(path.join(source, `${id}.ts`), id==='getter'?'export function work(runtime) { return { get hidden() { runtime.getterCalled(); return 1 } } }':invalidBusiness ? 'export function work() { return new Date(0) }' : 'export function work() { throw new Error("original engine failure") }');
      const engine = createCanonicalMaterializedWorkCtrlFlowEngine({ storeRoot: root, instanceId: id, checkpointConfig: {}, bundleDir: source,
        source: { revision: id, provenance: { authority: 'resource-package', artifactRef: 'resource://test.Fault' } },runtime:{getterCalled:()=>{getterCalls++}} });
      if (invalidBusiness) await expect(engine.start(id)).rejects.toThrow(id==='getter'?'data properties':'plain-data');
      else {
        expect((await engine.start(id)).status).toBe('Failed');
        const saved = await new FilesystemFlowRunCheckpointStore({ storeRoot: root }).load({ instanceId: id, runId: id });
        expect(saved?.state).toMatchObject({ __flow_execution__: { fault: { name: 'Error', message: 'original engine failure' } } });
      }
    }
    expect(getterCalls).toBe(0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
