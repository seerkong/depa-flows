import { expect, test } from 'bun:test';
import { normalizeFlowRunCheckpoint, normalizeWorkflowDelegation, delegateWorkflowTask, prepareWorkflowDelegationRetry,bindWorkflowTaskDelegation,validateWorkflowDelegationTransition } from 'ai-workflow-logic';
import type { WorkflowDelegationEffectPort, WorkflowDelegationRequest, WorkflowDelegationObservation } from 'ai-workflow-contract';
import { fixture, delegation, target } from './backflow-fixture.js';

const complete = (request: WorkflowDelegationRequest): WorkflowDelegationObservation => ({ invocationKey: request.lineage.invocationKey, attempt: request.attempt, receiptId: `receipt:${request.attempt}`, status: 'completed', target, output: request.delegation.task.input });
const port = (): WorkflowDelegationEffectPort => ({ verifyMaterials: async () => {}, submit: async request => complete(request), observe: async request => complete(request) });

test('accepted owner failure is terminal, never retried and fails the authored action instead of waiting forever',async()=>{
  let submits=0,observes=0;
  const h=await fixture({verifyMaterials:async()=>{},submit:async request=>{submits++;return {invocationKey:request.lineage.invocationKey,attempt:request.attempt,receiptId:'accepted-failure',status:'failed',settled:true,target,reason:'session_turn_failed'}},observe:async request=>{observes++;return complete(request)}});
  const failed=await delegateWorkflowTask(h.runtime(),delegation());expect(failed.status).toBe('failed');
  expect(await delegateWorkflowTask(h.runtime(),delegation())).toEqual(failed);
  expect(submits).toBe(1);expect(observes).toBe(0);
  const checkpoint=await h.read();
  await expect(prepareWorkflowDelegationRetry(h.runtime(),{expectedVersion:checkpoint.version,invocationKey:'draft#0',receiptId:'accepted-failure'})).rejects.toThrow('DELEGATION_RETRY_FORBIDDEN');
  await expect(bindWorkflowTaskDelegation(h.runtime()).delegateTask(delegation().task.input)).rejects.toThrow('DELEGATION_OWNER_FAILED');
  if(checkpoint.profile.kind==='WorkCtrlFlow')throw Error('AI required');
  const records=checkpoint.profile.ai.delegationsByKey!,record=records['draft#0'];
  expect(()=>validateWorkflowDelegationTransition(records,{'draft#0':{attempts:record.attempts.map(attempt=>({...attempt,observation:complete(attempt.request)}))}})).toThrow('DELEGATION_TERMINAL_IMMUTABLE');
});

test('canonical delegation receipts reject a foreign instance or run before they can become a source', async () => {
  const h = await fixture(port());
  await delegateWorkflowTask(h.runtime(), delegation());
  const original = await h.read();
  if (original.profile.kind === 'WorkCtrlFlow') throw Error('AI profile required');
  const record = original.profile.ai.delegationsByKey!['draft#0'];
  for (const field of ['instanceId', 'runId'] as const) {
    const attempts = record.attempts.map(attempt => ({ ...attempt, request: { ...attempt.request, lineage: { ...attempt.request.lineage, [field]: 'foreign' } } }));
    const value = { ...original, profile: { ...original.profile, ai: { ...original.profile.ai, delegationsByKey: { 'draft#0': { attempts } } } } };
    expect(() => normalizeFlowRunCheckpoint(value)).toThrow('canonical instance and run');
  }
});

test('delegation is distinct from strict Agent instance invocation', () => {
  expect(normalizeWorkflowDelegation({
    kind: 'workflow.task-delegation/v1',
    task: { nodeId: 'review', agentDefinitionRef: 'resource://Review', input: { task: 'Review the draft' } },
    context: { mode: 'reuse', owner: 'anchor', providerScope: 'workspace:one', targetId: 'session:one' },
    sessionPolicy: 'shared',
    materials: [],
  }).task.input).toEqual({ task: 'Review the draft' });
});

test('pending admission retains and validates the actual owner context', async () => {
  const p = port();
  p.submit = async request => ({ invocationKey: request.lineage.invocationKey, attempt: request.attempt, receiptId: 'accepted', status: 'awaiting-user', target });
  const h = await fixture(p);
  expect(await delegateWorkflowTask(h.runtime(), delegation())).toMatchObject({ status: 'awaiting-user', target });
  const wrong = port();
  wrong.submit = async request => ({ invocationKey: request.lineage.invocationKey, attempt: request.attempt, receiptId: 'bad-scope', status: 'pending', target: { ...target, providerScope: 'foreign' } });
  const other = await fixture(wrong);
  await expect(delegateWorkflowTask(other.runtime(), delegation())).rejects.toThrow('DELEGATION_OWNER_TARGET_MISMATCH');
});

test('different tasks share an admitted Session without changing strict Agent indexes', async () => {
  const review = { ...delegation('review'), context: { mode: 'from-node', nodeId: 'draft' } } as const;
  const h = await fixture(port(), [delegation(), review]);
  await delegateWorkflowTask(h.runtime(), delegation());
  const result = await delegateWorkflowTask(h.runtime('review', 0, { draft: 'draft#0' }), review);
  expect(result.status).toBe('completed');
  if (result.status === 'completed') expect(result.output).toEqual({ task: 'review' });
  const state = (await h.read()).profile as any;
  expect(state.ai.instancesById).toEqual({});
  expect(state.ai.delegationsByKey['review#0'].attempts[0].request.lineage.sourceInvocationKey).toBe('draft#0');
});

test('shared Session follows native serial loop visits while stale, foreign and unfinished visits stay rejected', async () => {
  const task = { ...delegation(), context: { mode: 'reuse', ...target } } as const;
  const visit = (iteration: number, scope = '', loop = 'loop') => JSON.stringify([scope, [{ key: loop, iteration }]]);
  const h = await fixture(port(), [task]);
  const first = { ...h.runtime(), visit: visit(0) };
  await delegateWorkflowTask(first, task);
  for (const current of [
    { ...h.runtime('draft', 1), visit: visit(0) },
    { ...h.runtime('draft', 1), visit: visit(1, 'lane:other') },
    { ...h.runtime('draft', 1), visit: visit(1, '', 'other-loop') },
    { ...h.runtime('draft', 1), visit: 'body' },
  ]) await expect(delegateWorkflowTask(current, task)).rejects.toThrow('DELEGATION_SHARED_TARGET_CONCURRENT');
  for (const generation of [1, 2]) {
    const result = await delegateWorkflowTask({ ...h.runtime('draft', generation), visit: visit(generation) }, { ...task, task: { ...task.task, input: { generation } } });
    expect(result).toMatchObject({ status: 'completed', target, output: { generation } });
  }
  let submissions = 0;
  const pending = await fixture({ ...port(), submit: async request => { submissions++; return { invocationKey: request.lineage.invocationKey, attempt: 0, receiptId: 'pending', status: 'busy', target }; } }, [task]);
  await delegateWorkflowTask({ ...pending.runtime(), visit: visit(0) }, task);
  await expect(delegateWorkflowTask({ ...pending.runtime('draft', 1), visit: visit(1) }, task)).rejects.toThrow('DELEGATION_SHARED_TARGET_CONCURRENT');
  expect(submissions).toBe(1);
});

test('outer loop serial order survives inner generation reset but never crosses a parallel lane', async () => {
  const task = { ...delegation(), context: { mode: 'reuse', ...target } } as const;
  const visit = (outer: number, inner: number, scope = '') => JSON.stringify([scope, [{ key: 'outer', iteration: outer }, { key: 'inner', iteration: inner }]]);
  const h = await fixture(port(), [task]);
  await delegateWorkflowTask({ ...h.runtime('draft', 2), invocationKey: 'draft#old', visit: visit(0, 2) }, task);
  await expect(delegateWorkflowTask({ ...h.runtime(), visit: visit(1, 0, 'lane:other') }, task)).rejects.toThrow('DELEGATION_SHARED_TARGET_CONCURRENT');
  expect(await delegateWorkflowTask({ ...h.runtime(), visit: visit(1, 0) }, task)).toMatchObject({ status: 'completed', target });
});

test('from-node rejects missing, unfinished, stale and independent sources before dispatch', async () => {
  for (const condition of ['missing', 'unfinished', 'stale', 'independent']) {
    let calls = 0;
    const p = port();
    p.submit = async request => { calls++; return condition === 'unfinished' ? { invocationKey: request.lineage.invocationKey, attempt: 0, receiptId: 'pending', status: 'pending' } : complete(request); };
    const first = { ...delegation(), sessionPolicy: condition === 'independent' ? 'independent-per-generation' : 'shared' } as const;
    const next = { ...delegation('review'), context: { mode: 'from-node', nodeId: 'draft' } } as const;
    const h = await fixture(p, [first, next]);
    await delegateWorkflowTask(h.runtime(), first);
    await expect(delegateWorkflowTask(h.runtime('review', condition === 'stale' ? 1 : 0, condition === 'missing' ? {} : { draft: 'draft#0' }), next)).rejects.toThrow();
    expect(calls).toBe(1);
  }
});

test('transport loss, restart and concurrent callers observe the same reservation without resend', async () => {
  let submits = 0, observes = 0;
  const p = port();
  p.submit = async () => { submits++; throw Error('lost receipt'); };
  p.observe = async request => { observes++; return complete(request); };
  const h = await fixture(p);
  await expect(delegateWorkflowTask(h.runtime(), delegation())).rejects.toThrow('unknown');
  const results = await Promise.all([delegateWorkflowTask(h.runtime(), delegation()), delegateWorkflowTask(h.runtime(), delegation())]);
  expect(results.map(r => r.status)).toEqual(['completed', 'completed']);
  expect(submits).toBe(1); expect(observes).toBeGreaterThan(0);
  await delegateWorkflowTask(h.runtime(), delegation());
  expect(submits).toBe(1);
});

test('busy, awaiting-user and unknown cannot prepare retry; settled rejection creates exactly one audited attempt', async () => {
  for (const status of ['busy', 'awaiting-user', 'unknown', 'rejected'] as const) {
    let submits = 0;
    const p = port();
    p.submit = async request => {
      submits++;
      const identity = { invocationKey: request.lineage.invocationKey, attempt: request.attempt, receiptId: 'original' };
      return status === 'rejected' ? { ...identity, status, settled: true, reason: 'provider refused' } : { ...identity, status };
    };
    const h = await fixture(p);
    await delegateWorkflowTask(h.runtime(), delegation());
    const checkpoint = await h.read();
    const retry = () => prepareWorkflowDelegationRetry(h.runtime(), { expectedVersion: checkpoint.version, invocationKey: 'draft#0', receiptId: 'original' });
    if (status !== 'rejected') { await expect(retry()).rejects.toThrow('DELEGATION_RETRY_FORBIDDEN'); continue; }
    await retry();
    await expect(retry()).rejects.toThrow('DELEGATION_RETRY_CAS_MISMATCH');
    await delegateWorkflowTask(h.runtime(), delegation());
    expect(submits).toBe(2);
    const records = (await h.read()).profile as any;
    expect(records.ai.delegationsByKey['draft#0'].attempts.map((a: any) => a.observation.status)).toEqual(['rejected', 'rejected']);
  }
});

test('material corruption, frozen binding drift and mismatched owner receipts fail closed', async () => {
  const p = port();
  let submits = 0;
  p.submit = async request => { submits++; return { ...complete(request), invocationKey: 'foreign' }; };
  const h = await fixture(p);
  await expect(delegateWorkflowTask(h.runtime(), { ...delegation(), context: { mode: 'reuse', ...target } })).rejects.toThrow('DELEGATION_FROZEN_BINDING_MISMATCH');
  expect(submits).toBe(0);
  p.verifyMaterials = async () => { throw Error('material hash mismatch'); };
  await expect(delegateWorkflowTask(h.runtime(), delegation())).rejects.toThrow('material hash mismatch');
  expect(submits).toBe(0);
  p.verifyMaterials = async () => {};
  await expect(delegateWorkflowTask(h.runtime(), delegation())).rejects.toThrow('DELEGATION_RECEIPT_IDENTITY_MISMATCH');
  expect(submits).toBe(1);
});

test('independent generations reject reused actual contexts and terminal history rewrites', async () => {
  const task = { ...delegation(), sessionPolicy: 'independent-per-generation' } as const;
  const h = await fixture(port(), [task]);
  await delegateWorkflowTask(h.runtime(), task);
  await expect(delegateWorkflowTask(h.runtime('draft', 1), task)).rejects.toThrow('DELEGATION_FRESH_CONTEXT_REUSED');
  const checkpoint = await h.read();
  const changed = structuredClone(checkpoint) as any;
  changed.version++;
  changed.profile.ai.delegationsByKey['draft#0'].attempts[0].request.delegation.task.input = { forged: true };
  await expect(h.store.commit({ expectedVersion: checkpoint.version, checkpoint: changed })).rejects.toThrow('DELEGATION_RESERVATION_IMMUTABLE');
});

test('host execution values are frozen, persist unchanged and cannot drift before dispatch or during observation',async()=>{
  const execution={schemaVersion:'fixture-owner/v1',backend:'native',modelRef:'provider/model',options:{value:'原配置🙂'}};
  const task={...delegation(),execution},requests:WorkflowDelegationRequest[]=[];
  const effects:WorkflowDelegationEffectPort={verifyMaterials:async()=>{},submit:async request=>{requests.push(request);return {invocationKey:request.lineage.invocationKey,attempt:request.attempt,receiptId:'pending-original',status:'unknown',target}},observe:async request=>{requests.push(request);return complete(request)}};
  const h=await fixture(effects,[task]);
  await expect(delegateWorkflowTask(h.runtime(),{...task,execution:{...execution,modelRef:'foreign/model'}})).rejects.toThrow('DELEGATION_FROZEN_BINDING_MISMATCH');expect(requests).toHaveLength(0);
  await delegateWorkflowTask(h.runtime(),task);execution.options.value='changed after dispatch';
  const checkpoint=normalizeFlowRunCheckpoint(await h.read());if(checkpoint.profile.kind==='WorkCtrlFlow')throw Error('AI required');
  const original=checkpoint.profile.ai.delegationsByKey!['draft#0']!.attempts[0]!.request.delegation;
  expect(original.execution).toEqual({schemaVersion:'fixture-owner/v1',backend:'native',modelRef:'provider/model',options:{value:'原配置🙂'}});expect(Object.isFrozen(original.execution)).toBe(true);
  await delegateWorkflowTask(h.runtime(),original);expect(requests).toHaveLength(2);expect(requests[1]!.delegation.execution).toEqual(requests[0]!.delegation.execution);
  const legacy=normalizeWorkflowDelegation(delegation());expect(Object.hasOwn(legacy,'execution')).toBe(false);
  expect(()=>normalizeWorkflowDelegation({...delegation(),execution:{value:'文'.repeat(6000)}})).toThrow('DELEGATION_EXECUTION_LIMIT');
  expect(()=>normalizeWorkflowDelegation({...delegation(),execution:{get secret(){throw Error('getter must not execute')}}})).toThrow();
  expect(()=>normalizeWorkflowDelegation({...delegation(),execution:{value:()=>{}}})).toThrow();
});
