/**
 * Sequence Node Logic
 *
 * Executes children in order. All must succeed for the sequence to succeed.
 * If any child fails, the entire sequence fails.
 */

import { NodeLogicBase } from '../NodeLogic';
import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorResult,
  INodeConfig,
  BehaviorTreeNodeStatus,
} from '../types';

export class SequenceNodeLogic<
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
      // No children or all omitted - success
      node.Status = BehaviorTreeNodeStatus.Success;
      this.notifyParentNodeFinish(node, BehaviorResult.Success, btData);
    }
  }

  onChildNodeFinish(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    childResult: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    if (childResult === BehaviorResult.Failure) {
      // Any child fails -> sequence fails
      node.Status = BehaviorTreeNodeStatus.Failure;
      this.markRemainingChildrenAsOmitted(node, childIndex);
      this.notifyParentNodeFinish(node, BehaviorResult.Failure, btData);
    } else if (childResult === BehaviorResult.Success) {
      // Child succeeded, try next
      const nextChild = this.getNextExecutableChild(node, childIndex);
      if (nextChild) {
        this.pushVisitNodeCmd(nextChild, btData);
      } else {
        // All children succeeded
        node.Status = BehaviorTreeNodeStatus.Success;
        this.notifyParentNodeFinish(node, BehaviorResult.Success, btData);
      }
    }
    // Running state handled externally
  }

  onFinishLeafNode(
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _result: BehaviorResult,
    _btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    throw new Error('Sequence node should not be a leaf node');
  }
}
