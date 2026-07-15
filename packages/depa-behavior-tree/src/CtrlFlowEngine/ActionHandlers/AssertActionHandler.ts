/**
 * Assert Action Handler
 *
 * Handles assertions in test execution
 */

import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { ExecutionContext, BehaviorResult } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType, AssertConfig } from '../types';

/**
 * Handler for Assert action
 *
 * Evaluates an expression and fails if it's false
 */
export class AssertActionHandler implements ActionHandler<CtrlFlowNodeType, AssertConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, AssertConfig>): Promise<BehaviorResult> {
    const { node } = context;
    const config = node.Config;

    try {
      // Evaluate the assertion expression
      const result = context.evalExpression(config.expression);

      if (result) {
        return BehaviorResult.Success;
      } else {
        const errorMessage = config.errorMessage || `Assertion failed: ${config.expression}`;
        const logEnabled = config.logOnFailure === true;
        if (logEnabled) {
          // Keep optional logging for explicit opt-in to avoid noisy console during expected failures
          // eslint-disable-next-line no-console
          console.error(`[${node.Key}] ${errorMessage}`);
        }
        return BehaviorResult.Failure;
      }
    } catch (error) {
      const errorMessage = config.errorMessage || `Assertion error: ${config.expression}`;
      // Unexpected errors should still be logged for visibility
      // eslint-disable-next-line no-console
      console.error(`[${node.Key}] ${errorMessage}`, error);
      return BehaviorResult.Failure;
    }
  }
}
