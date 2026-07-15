/**
 * Sleep Action Handler
 *
 * Handles delayed execution in tests
 */

import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { ExecutionContext, BehaviorResult } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType, SleepConfig } from '../types';

/**
 * Handler for Sleep action
 *
 * Pauses execution for a specified duration
 */
export class SleepActionHandler implements ActionHandler<CtrlFlowNodeType, SleepConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, SleepConfig>): Promise<BehaviorResult> {
    const { node } = context;
    const config = node.Config;

    try {
      const duration = config.duration;

      if (duration < 0) {
        console.error(`[${node.Key}] Invalid sleep duration: ${duration}`);
        return BehaviorResult.Failure;
      }

      // Sleep for the specified duration
      await new Promise((resolve) => setTimeout(resolve, duration));

      return BehaviorResult.Success;
    } catch (error) {
      console.error(`Sleep failed for node ${node.Key}:`, error);
      return BehaviorResult.Failure;
    }
  }
}
