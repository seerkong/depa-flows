/**
 * NodeLogic Dispatcher
 *
 * 使用 DispatchEngine 实现 NodeKind -> NodeLogic Adapter 的分发
 * 这是行为树的第一层分发机制
 */

import { BehaviorTreeCoreRuntime } from './BehaviorTreeCoreRuntime';
import {
  BehaviorTreeNode,
  BehaviorTreeNodeKind,
  BehaviorResult,
  INodeConfig,
} from './types';
import { ActionHandlerRegistry } from './ActionHandler';
import { DispatchEngine } from 'depa-processor';
import { DispatchStrategyType } from 'depa-processor';
import { EnumDispatchRequest } from 'depa-processor';
import { DispatchStrategyConfig } from 'depa-processor';
import { SequenceNodeLogicAdapter } from './adapters/SequenceNodeLogicAdapter';
import { SelectorNodeLogicAdapter } from './adapters/SelectorNodeLogicAdapter';
import { ConditionNodeLogicAdapter } from './adapters/ConditionNodeLogicAdapter';
import { ActionNodeLogicAdapter } from './adapters/ActionNodeLogicAdapter';
import { UntilNodeLogicAdapter } from './adapters/UntilNodeLogicAdapter';

/**
 * NodeLogic 分发请求
 */
interface NodeLogicDispatchInput<TNodeType, TConfig extends INodeConfig> {
  runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>;
  node: BehaviorTreeNode<TNodeType, TConfig>;
  commandType: 'VisitNode' | 'FinishLeafNode' | 'FinishChildNode';
  childIndex?: number;
  childResult?: BehaviorResult;
  leafResult?: BehaviorResult;
}

/**
 * NodeLogic 分发结果
 */
interface NodeLogicDispatchOutput {
  success: boolean;
}

/**
 * NodeLogic Dispatcher
 *
 * 使用 DispatchEngine 的 ENUM 策略进行 NodeKind 分发
 */
export class NodeLogicDispatcher<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
> {
  private dispatchEngine: DispatchEngine<NodeLogicDispatchOutput>;
  private sequenceAdapter: SequenceNodeLogicAdapter<TNodeType, TConfig>;
  private selectorAdapter: SelectorNodeLogicAdapter<TNodeType, TConfig>;
  private conditionAdapter: ConditionNodeLogicAdapter<TNodeType, TConfig>;
  private actionAdapter: ActionNodeLogicAdapter<TNodeType, TConfig>;
  private untilAdapter: UntilNodeLogicAdapter<TNodeType, TConfig>;

  constructor(actionHandlerRegistry: ActionHandlerRegistry<TNodeType, TConfig>) {
    // 创建各个适配器实例
    this.sequenceAdapter = new SequenceNodeLogicAdapter<TNodeType, TConfig>();
    this.selectorAdapter = new SelectorNodeLogicAdapter<TNodeType, TConfig>();
    this.conditionAdapter = new ConditionNodeLogicAdapter<TNodeType, TConfig>();
    this.actionAdapter = new ActionNodeLogicAdapter<TNodeType, TConfig>(
      actionHandlerRegistry
    );
    this.untilAdapter = new UntilNodeLogicAdapter<TNodeType, TConfig>();

    // 创建分发引擎
    this.dispatchEngine = new DispatchEngine<NodeLogicDispatchOutput>();

    // 注册 ENUM 策略：NodeKind -> Adapter
    this.registerNodeKindDispatch();
  }

  /**
   * 注册 NodeKind 分发策略
   */
  private registerNodeKindDispatch(): void {
    const handlerMap = new Map<
      BehaviorTreeNodeKind,
      (input: unknown) => Promise<NodeLogicDispatchOutput>
    >();

    // 为每个 NodeKind 注册对应的适配器处理函数
    handlerMap.set(BehaviorTreeNodeKind.Sequence, async (input: unknown) => {
      const dispatchInput = input as NodeLogicDispatchInput<TNodeType, TConfig>;
      this.callAdapterMethod(
        this.sequenceAdapter,
        dispatchInput.runtime,
        dispatchInput.node,
        dispatchInput.commandType,
        dispatchInput
      );
      return { success: true };
    });

    handlerMap.set(BehaviorTreeNodeKind.Selector, async (input: unknown) => {
      const dispatchInput = input as NodeLogicDispatchInput<TNodeType, TConfig>;
      this.callAdapterMethod(
        this.selectorAdapter,
        dispatchInput.runtime,
        dispatchInput.node,
        dispatchInput.commandType,
        dispatchInput
      );
      return { success: true };
    });

    handlerMap.set(BehaviorTreeNodeKind.Condition, async (input: unknown) => {
      const dispatchInput = input as NodeLogicDispatchInput<TNodeType, TConfig>;
      this.callAdapterMethod(
        this.conditionAdapter,
        dispatchInput.runtime,
        dispatchInput.node,
        dispatchInput.commandType,
        dispatchInput
      );
      return { success: true };
    });

    handlerMap.set(BehaviorTreeNodeKind.Action, async (input: unknown) => {
      const dispatchInput = input as NodeLogicDispatchInput<TNodeType, TConfig>;
      return await this.actionAdapter.dispatch(dispatchInput.runtime, {
        node: dispatchInput.node,
        commandType: dispatchInput.commandType,
        leafResult: dispatchInput.leafResult,
      });
    });

    handlerMap.set(BehaviorTreeNodeKind.Until, async (input: unknown) => {
      const dispatchInput = input as NodeLogicDispatchInput<TNodeType, TConfig>;
      this.callAdapterMethod(
        this.untilAdapter,
        dispatchInput.runtime,
        dispatchInput.node,
        dispatchInput.commandType,
        dispatchInput
      );
      return { success: true };
    });

    // 创建 ENUM 分发配置
    const enumConfig = DispatchStrategyConfig.forEnumStrategy<NodeLogicDispatchOutput>({
      handlerMap,
      defaultEnumHandler: async (routeEnum: string | number, _input: unknown) => {
        throw new Error(`No handler found for NodeKind: ${routeEnum}`);
      },
    });

    this.dispatchEngine.registerStrategy(enumConfig);
  }

  /**
   * 调用 Adapter 的相应方法
   */
  private callAdapterMethod(
    adapter:
      | SequenceNodeLogicAdapter<TNodeType, TConfig>
      | SelectorNodeLogicAdapter<TNodeType, TConfig>
      | ConditionNodeLogicAdapter<TNodeType, TConfig>
      | UntilNodeLogicAdapter<TNodeType, TConfig>,
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    commandType: string,
    dispatchInput: NodeLogicDispatchInput<TNodeType, TConfig>
  ): void {
    switch (commandType) {
      case 'VisitNode':
        adapter.visitNode(runtime, node);
        break;

      case 'FinishLeafNode':
        adapter.onFinishLeafNode(runtime, node, dispatchInput.leafResult!);
        break;

      case 'FinishChildNode':
        adapter.onChildNodeFinish(
          runtime,
          node,
          dispatchInput.childIndex!,
          dispatchInput.childResult!
        );
        break;

      default:
        throw new Error(`Unknown command type: ${commandType}`);
    }
  }

  /**
   * 分发执行
   */
  async dispatch(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    commandType: 'VisitNode' | 'FinishLeafNode' | 'FinishChildNode',
    options?: {
      childIndex?: number;
      childResult?: BehaviorResult;
      leafResult?: BehaviorResult;
    }
  ): Promise<void> {
    const request: EnumDispatchRequest<NodeLogicDispatchOutput> = {
      type: DispatchStrategyType.ENUM,
      routeEnum: node.Kind,
      input: {
        runtime,
        node,
        commandType,
        childIndex: options?.childIndex,
        childResult: options?.childResult,
        leafResult: options?.leafResult,
      } as NodeLogicDispatchInput<TNodeType, TConfig>,
    };

    const result = await this.dispatchEngine.dispatch(request);

    if (!result.isHandled()) {
      throw new Error(`Failed to dispatch node kind: ${node.Kind}`);
    }
  }

  /**
   * 便捷方法：访问节点
   */
  async visitNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): Promise<void> {
    await this.dispatch(runtime, node, 'VisitNode');
  }

  /**
   * 便捷方法：完成叶子节点
   */
  async finishLeafNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult
  ): Promise<void> {
    await this.dispatch(runtime, node, 'FinishLeafNode', { leafResult: result });
  }

  /**
   * 便捷方法：子节点完成
   */
  async finishChildNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    result: BehaviorResult
  ): Promise<void> {
    await this.dispatch(runtime, node, 'FinishChildNode', {
      childIndex,
      childResult: result,
    });
  }
}
