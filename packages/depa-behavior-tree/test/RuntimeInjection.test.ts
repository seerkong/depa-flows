import { describe, it, expect } from 'bun:test';
import {
  ActionHandlerRegistry,
  BehaviorResult,
  BehaviorTreeCmd,
  BehaviorTreeData,
  BehaviorTreeEngine,
  BehaviorTreeNode,
  BehaviorTreeNodeKind,
  BehaviorTreeNodeStatus,
  INodeConfig,
  createExecutionContext,
} from '../src/BehaviorTreeCore';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

enum TestNodeType {
  Action = 'Action',
}

interface TestConfig extends INodeConfig {
  value?: string;
}

function makeActionTree(): BehaviorTreeNode<TestNodeType, TestConfig> {
  return {
    Kind: BehaviorTreeNodeKind.Action,
    Type: TestNodeType.Action,
    Key: 'root',
    Status: BehaviorTreeNodeStatus.Init,
    Config: {},
    Children: [],
  };
}

function makeBtData(tree: BehaviorTreeNode<TestNodeType, TestConfig>): BehaviorTreeData<TestNodeType, TestConfig> {
  return {
    NodeTree: tree,
    Vars: new Map(),
    CmdStack: [] as BehaviorTreeCmd[],
    CmdHistory: [] as BehaviorTreeCmd[],
    NodeMap: new Map(),
  };
}

describe('Runtime injection', () => {
  it('createExecutionContext carries optional runtime', () => {
    const tree = makeActionTree();
    const btData = makeBtData(tree);
    const runtime = { sideEffect: { ping: true } };

    const context = createExecutionContext(
      tree,
      btData,
      () => true,
      runtime
    );

    expect(context.runtime).toBe(runtime);
  });

  it('BehaviorTreeEngine passes runtime into action handler context', async () => {
    let receivedRuntime: unknown;

    const registry = new ActionHandlerRegistry<TestNodeType, TestConfig>();
    registry.register(TestNodeType.Action, {
      execute: async (context) => {
        receivedRuntime = context.runtime;
        return BehaviorResult.Success;
      },
    });

    const engine = new BehaviorTreeEngine<TestNodeType, TestConfig>(registry, () => true);
    const tree = makeActionTree();
    const btData = makeBtData(tree);
    const runtime = { marker: 'runtime-object' };

    await engine.start(btData, runtime);
    while (!engine.isComplete(btData)) {
      await engine.runPendingCommands(btData, runtime);
    }

    expect(receivedRuntime).toBe(runtime);
    expect(btData.NodeTree.Status).toBe(BehaviorTreeNodeStatus.Success);
  });

  it('CtrlFlowEngine forwards runtime to node execution context', async () => {
    const tree = CtrlFlowDsl.sequence(
      CtrlFlowDsl.runScript('setVar("hasRuntime", Boolean(context.runtime));')
    );

    const withRuntimeEngine = new CtrlFlowEngine({ runtime: { marker: true } });
    const withRuntime = await withRuntimeEngine.runTest(tree);
    expect(withRuntime.success).toBe(true);
    expect(withRuntime.variables.hasRuntime).toBe(true);

    const withoutRuntimeEngine = new CtrlFlowEngine();
    const withoutRuntime = await withoutRuntimeEngine.runTest(tree);
    expect(withoutRuntime.success).toBe(true);
    expect(withoutRuntime.variables.hasRuntime).toBe(false);
  });
});
