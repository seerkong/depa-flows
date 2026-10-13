import { BehaviorResult, type ActionHandler, type CtrlFlowNodeType, type INodeConfig } from 'depa-behavior-tree';
import { createFlowHandlers, flowStateOf } from 'instant-ctrl-flow-logic';
import { WaitNodeHandler, type TickController, type WorkCtrlFlowEngineOptions } from 'work-ctrl-flow-logic';
import type { FlowBundleSpec, FlowCodeResolver } from 'instant-ctrl-flow-contract';
import { WorkflowDelegationSuspendedError } from 'ai-workflow-logic';

/** Uses the existing scheduler, native WaitHandles and resume token history. */
export function createAICtrlWorkflowDelegationHandlers(
  spec: FlowBundleSpec,
  resolveCode: FlowCodeResolver,
  bindNodeRuntime: WorkCtrlFlowEngineOptions['bindNodeRuntime'],
  controller: () => TickController,
): Record<string, ActionHandler<CtrlFlowNodeType, INodeConfig>> {
  const handlers = createFlowHandlers(spec, resolveCode, {
    begin: () => { throw Error('Delegation Run handler does not own branch decisions'); },
    record: () => { throw Error('Delegation Run handler does not own branch decisions'); },
    runtimeForNode: (nodeId, runtime, state) => bindNodeRuntime?.(runtime, controller().runtimeIdentity(nodeId, state)) ?? runtime,
  });
  return { 'flow.Run': { async execute(ctx) {
    const c = controller();
    if (c.suspended.length) { c.inertKeys.add(ctx.node.Key); return BehaviorResult.Failure; }
    const key = c.invocationKeyFor(ctx.node.Key);
    const recorded = c.snapshot.nodeResults[key];
    if (recorded) {
      if (bindNodeRuntime) c.invocationKeyFor(ctx.node.Key);
      return recorded === 'Success' ? BehaviorResult.Success : BehaviorResult.Failure;
    }
    const result = await handlers['flow.Run']!.execute(ctx);
    const flow = flowStateOf(ctx);
    if (!(flow.fault instanceof WorkflowDelegationSuspendedError)) {
      if (result !== BehaviorResult.Running) c.snapshot.nodeResults[key] = result === BehaviorResult.Success ? 'Success' : 'Failure';
      for (const handle of [...c.snapshot.openWaitHandles]) {
        if (!handle.nodeKey.startsWith(`${ctx.node.Key}:delegation:`) || handle.signalKey !== key) continue;
        handle.status = 'Consumed'; handle.closedAtMs = c.now();
        c.snapshot.appliedResumeSignals.push(`${handle.waitHandleId}:${handle.resumeToken}`);
        c.snapshot.waitResults[handle.invocationKey] = { result: result === BehaviorResult.Success ? 'Success' : 'Failure' };
        c.snapshot.openWaitHandles = c.snapshot.openWaitHandles.filter(item => item !== handle);
        c.snapshot.closedWaitHandles.push(handle);
      }
      return result;
    }
    const delegationInvocationKey = flow.fault.invocationKey;
    const status = flow.fault.status;
    delete flow.fault;
    // Signal payload is only a wakeup; task output always comes from owner observation.
    const prefix = `${ctx.node.Key}:delegation:`;
    const scope=key.slice(0,key.lastIndexOf('/')+1);
    const count = c.snapshot.closedWaitHandles.filter(handle => handle.nodeKey.startsWith(prefix) && handle.invocationKey.startsWith(`${scope}${prefix}`)).length;
    const proxy = Object.create(ctx);
    Object.defineProperty(proxy, 'node', { value: { ...ctx.node, Key: `${prefix}${count}`, Config: { signalKind: 'workflow.delegation.observe', signalKey: key } } });
    return new WaitNodeHandler('external-job', controller, async (_ctx, handle) => {
      handle.metadata = { workflowDelegation: { kind: 'workflow.task-delegation/v1', invocationKey: delegationInvocationKey, actionInvocationKey: key, status } };
    }).execute(proxy);
  } } };
}
