/**
 * NodeLogic Adapter - OOP Style
 *
 * 基于 StdRunComponentLogic 的标准化组件封装
 * 每个 NodeLogic 只需实现 makeInnerInput 和 runCoreLogic
 */

import { BehaviorTreeCoreRuntime } from './BehaviorTreeCoreRuntime';
import { BehaviorTreeNode, INodeConfig } from './types';
import {
  runByFuncStyleAdapter,
  stdMakeNullOuterComputed,
  stdMakeIdentityInnerRuntime,
  stdMakeIdentityInnerConfig,
} from 'depa-processor';

/**
 * NodeLogic 执行请求（输入）
 */
export interface NodeLogicRequest<TNodeType, TConfig extends INodeConfig> {
  node: BehaviorTreeNode<TNodeType, TConfig>;
  command?: any; // VisitNode, FinishLeafNode, FinishChildNode
}

/**
 * NodeLogic 执行结果（输出）
 */
export interface NodeLogicResult {
  success: boolean;
  message?: string;
}

/**
 * NodeLogic Adapter Base Class (OOP Style)
 *
 * 遵循 output = fn(runtime, input, config) 的组件抽象
 * 使用 StdRunComponentLogic 标准化封装
 */
export abstract class NodeLogicAdapter<TNodeType, TConfig extends INodeConfig> {
  /**
   * 将外部请求转换为内部输入
   * 业务层只需实现此方法，提取所需数据
   */
  abstract makeInnerInput(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    request: NodeLogicRequest<TNodeType, TConfig>
  ): any;

  /**
   * 执行核心业务逻辑
   * 业务层只需实现此方法，处理节点执行
   */
  abstract runCoreLogic(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    input: any
  ): NodeLogicResult;

  /**
   * 分发执行（标准化封装）
   * 使用 StdRunComponentLogic.runByFuncStyleAdapter
   */
  dispatch(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    request: NodeLogicRequest<TNodeType, TConfig>
  ): Promise<NodeLogicResult> {
    return runByFuncStyleAdapter(
      runtime,
      request,
      null,
      // outerDerived: 不需要计算派生数据
      stdMakeNullOuterComputed,
      // innerRuntime: 直接透传
      stdMakeIdentityInnerRuntime,
      // innerInput: 调用 makeInnerInput
      (rt, req, _cfg, _derived) => this.makeInnerInput(rt, req),
      // innerConfig: 直接透传
      stdMakeIdentityInnerConfig,
      // coreLogic: 调用 runCoreLogic
      (rt, input, _cfg) => this.runCoreLogic(rt, input),
      // outerOutput: 直接返回结果
      (_rt, _req, _cfg, _derived, result) => result
    );
  }

  /**
   * 便捷方法：访问节点
   */
  visitNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): Promise<NodeLogicResult> {
    return this.dispatch(runtime, { node, command: 'VisitNode' });
  }

  /**
   * 便捷方法：完成叶子节点
   */
  finishLeafNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: any
  ): Promise<NodeLogicResult> {
    return this.dispatch(runtime, {
      node,
      command: { type: 'FinishLeafNode', result },
    });
  }

  /**
   * 便捷方法：子节点完成
   */
  finishChildNode(
    runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    result: any
  ): Promise<NodeLogicResult> {
    return this.dispatch(runtime, {
      node,
      command: { type: 'FinishChildNode', childIndex, result },
    });
  }
}
