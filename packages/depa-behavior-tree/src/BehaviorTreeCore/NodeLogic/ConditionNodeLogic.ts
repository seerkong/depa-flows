/**
 * Condition Node Logic
 *
 * Evaluates an expression and returns Success or Failure based on the result
 */

import { NodeLogicBase } from '../NodeLogic';
import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorResult,
  INodeConfig,
  IExpressionNodeConfig,
  BehaviorTreeNodeStatus,
  BehaviorTreeCmdType,
} from '../types';

export class ConditionNodeLogic<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
> extends NodeLogicBase<TNodeType, TConfig> {

  constructor(private evaluateExpression: (expr: string, btData: BehaviorTreeData<TNodeType, TConfig>, nodeKey: string) => boolean) {
    super();
  }

  visitNode(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    node.Status = BehaviorTreeNodeStatus.Started;

    // Evaluate the expression
    const config = node.Config as unknown as IExpressionNodeConfig;
    let conditionResult = false;

    try {
      conditionResult = this.evaluateExpression(config.expression, btData, node.Key);
    } catch (error) {
      console.error(`Error evaluating condition: ${config.expression}`, error);
      conditionResult = false;
    }

    // Push finish command
    btData.CmdStack.push({
      Type: BehaviorTreeCmdType.FinishLeafNode,
      NodeId: node.Key,
      Result: conditionResult ? BehaviorResult.Success : BehaviorResult.Failure,
    });
  }

  onChildNodeFinish(
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _childIndex: number,
    _childResult: BehaviorResult,
    _btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    throw new Error('Condition node should not have children');
  }

  onFinishLeafNode(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    result: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    node.Status =
      result === BehaviorResult.Success
        ? BehaviorTreeNodeStatus.Success
        : BehaviorTreeNodeStatus.Failure;

    this.notifyParentNodeFinish(node, result, btData);
  }
}
