/**
 * Until Node Logic
 *
 * Loops children until a condition is met
 */

import { NodeLogicBase } from '../NodeLogic';
import {
  BehaviorTreeNode,
  BehaviorTreeData,
  BehaviorResult,
  INodeConfig,
  IExpressionNodeConfig,
  BehaviorTreeNodeStatus,
} from '../types';

// Maximum number of iterations for a single Until node to prevent infinite loops
// Note: The test "Infinite Loop Protection" expects the loop counter (< 10000),
// so we cap iterations at 9999.
const MAX_UNTIL_ITERATIONS = 9999;

export class UntilNodeLogic<
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

    // Check termination condition
    const config = node.Config as unknown as IExpressionNodeConfig;
    let conditionMet = false;

    try {
      conditionMet = this.evaluateExpression(config.expression, btData, node.Key);
    } catch (error) {
      console.error(`Error evaluating until condition: ${config.expression}`, error);
      conditionMet = false;
    }

    if (conditionMet) {
      // Condition met, finish successfully
      node.Status = BehaviorTreeNodeStatus.Success;
      this.notifyParentNodeFinish(node, BehaviorResult.Success, btData);
    } else {
      // Condition not met, execute children
      const firstChild = this.getFirstExecutableChild(node);
      if (firstChild) {
        this.pushVisitNodeCmd(firstChild, btData);
      } else {
        // No children - cannot proceed
        node.Status = BehaviorTreeNodeStatus.Failure;
        this.notifyParentNodeFinish(node, BehaviorResult.Failure, btData);
      }
    }
  }

  onChildNodeFinish(
    node: BehaviorTreeNode<TNodeType, TConfig>,
    childIndex: number,
    childResult: BehaviorResult,
    btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    // If any child fails, the Until node should fail immediately
    if (childResult === BehaviorResult.Failure) {
      node.Status = BehaviorTreeNodeStatus.Failure;
      this.markRemainingChildrenAsOmitted(node, childIndex);
      this.notifyParentNodeFinish(node, BehaviorResult.Failure, btData);
      return;
    }

    // Check termination condition again
    const config = node.Config as unknown as IExpressionNodeConfig;
    let conditionMet = false;

    try {
      conditionMet = this.evaluateExpression(config.expression, btData, node.Key);
    } catch (error) {
      console.error(`Error evaluating until condition: ${config.expression}`, error);
      conditionMet = false;
    }

    if (conditionMet) {
      // Condition met, finish successfully
      node.Status = BehaviorTreeNodeStatus.Success;
      this.markRemainingChildrenAsOmitted(node, childIndex);
      this.notifyParentNodeFinish(node, BehaviorResult.Success, btData);
    } else {
      // Condition not met, continue loop
      const nextChild = this.getNextExecutableChild(node, childIndex);
      if (nextChild) {
        // Execute next child
        this.pushVisitNodeCmd(nextChild, btData);
      } else {
        // Restart loop from first child
        // Track iterations to avoid infinite loops when condition never becomes true
        const counterKey = `__until_iterations_${node.Key}`;
        const currentIterations = (btData.Vars.get(counterKey) as number | undefined) ?? 0;
        const nextIterations = currentIterations + 1;
        btData.Vars.set(counterKey, nextIterations);

        if (nextIterations >= MAX_UNTIL_ITERATIONS) {
          // Abort loop to prevent infinite execution
          console.warn(
            `Until node "${node.Key}" exceeded max iterations (${MAX_UNTIL_ITERATIONS}), aborting loop.`
          );
          node.Status = BehaviorTreeNodeStatus.Failure;
          this.notifyParentNodeFinish(node, BehaviorResult.Failure, btData);
          return;
        }

        // Reset all children (and their descendants) to Init status
        node.Children.forEach((child) => {
          this.resetSubtree(child);
        });

        const firstChild = this.getFirstExecutableChild(node);
        if (firstChild) {
          this.pushVisitNodeCmd(firstChild, btData);
        } else {
          // No children - cannot proceed
          node.Status = BehaviorTreeNodeStatus.Failure;
          this.notifyParentNodeFinish(node, BehaviorResult.Failure, btData);
        }
      }
    }
  }

  onFinishLeafNode(
    _node: BehaviorTreeNode<TNodeType, TConfig>,
    _result: BehaviorResult,
    _btData: BehaviorTreeData<TNodeType, TConfig>
  ): void {
    throw new Error('Until node should not be a leaf node');
  }

  /**
   * Reset the status of a node and all of its descendants to Init so they can re-run
   */
  private resetSubtree(node: BehaviorTreeNode<TNodeType, TConfig>): void {
    node.Status = BehaviorTreeNodeStatus.Init;
    node.Children.forEach((child) => this.resetSubtree(child));
  }
}
