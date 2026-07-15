/**
 * Selector Node Logic
 *
 * Tries children in order. Succeeds if any child succeeds.
 * Fails only if all children fail.
 */

import { NodeLogicBase } from '../NodeLogic';
import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorResult,
  INodeConfig,
  BehaviorTreeNodeStatus,
} from '../types';

export class SelectorNodeLogic<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
> extends NodeLogicBase<TNodeType, TConfig> {
  visitNode(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    node.Status = BehaviorTreeNodeStatus.Started;

    const firstChild = this.getFirstExecutableChild(node);
    if (firstChild) {
      this.pushVisitNodeCmd(firstChild, btData);
    } else {
      // No children or all omitted - failure
      node.Status = BehaviorTreeNodeStatus.Failure;
      this.notifyParentNodeFinish(node, BehaviorResult.Failure, btData);
    }
  }

  onChildNodeFinish(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    childResult: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    if (childResult === BehaviorResult.Success) {
      // Any child succeeds -> selector succeeds
      node.Status = BehaviorTreeNodeStatus.Success;
      this.markRemainingChildrenAsOmitted(node, childIndex);
      this.notifyParentNodeFinish(node, BehaviorResult.Success, btData);
    } else if (childResult === BehaviorResult.Failure) {
      // Child failed, try next
      const nextChild = this.getNextExecutableChild(node, childIndex);
      if (nextChild) {
        this.pushVisitNodeCmd(nextChild, btData);
      } else {
        // All children failed
        node.Status = BehaviorTreeNodeStatus.Failure;
        this.notifyParentNodeFinish(node, BehaviorResult.Failure, btData);
      }
    }
    // Running state handled externally
  }

  onFinishLeafNode(
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _result: BehaviorResult,
    _btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    throw new Error('Selector node should not be a leaf node');
  }
}
