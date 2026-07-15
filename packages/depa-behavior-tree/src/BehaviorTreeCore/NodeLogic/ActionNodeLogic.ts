/**
 * Action Node Logic
 *
 * Executes leaf action nodes with second-layer dispatch to action handlers
 */

import { NodeLogicBase } from '../NodeLogic';
import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorResult,
  INodeConfig,
  BehaviorTreeNodeStatus,
  BehaviorTreeCmdType,
} from '../types';
import { ActionHandlerRegistry, createExecutionContext } from '../ActionHandler';

export class ActionNodeLogic<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
> extends NodeLogicBase<TNodeType, TConfig> {

  constructor(
    private actionHandlerRegistry: ActionHandlerRegistry<TNodeType, TConfig>,
    private evaluateExpression: (expr: string, btData: BehaviorTreeData<TNodeType, TConfig>, nodeKey: string) => any
  ) {
    super();
  }

  visitNode(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    node.Status = BehaviorTreeNodeStatus.Started;

    // Second-layer dispatch: find handler for this action type
    const handler = this.actionHandlerRegistry.getHandler(node.Type);

    if (!handler) {
      console.error(`No action handler registered for type: ${node.Type}`);
      // Push failure command
      btData.CmdStack.push({
        Type: BehaviorTreeCmdType.FinishLeafNode,
        NodeId: node.Key,
        Result: BehaviorResult.Failure,
      });
      return;
    }

    // Create execution context
    const context = createExecutionContext(node, btData, this.evaluateExpression);

    // Execute handler asynchronously
    handler
      .execute(context)
      .then((result) => {
        // Push finish command
        btData.CmdStack.push({
          Type: BehaviorTreeCmdType.FinishLeafNode,
          NodeId: node.Key,
          Result: result,
        });
      })
      .catch((error) => {
        console.error(`Error executing action handler:`, error);
        // Push failure command
        btData.CmdStack.push({
          Type: BehaviorTreeCmdType.FinishLeafNode,
          NodeId: node.Key,
          Result: BehaviorResult.Failure,
        });
      });
  }

  onChildNodeFinish(
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _childIndex: number,
    _childResult: BehaviorResult,
    _btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    throw new Error('Action node should not have children');
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
