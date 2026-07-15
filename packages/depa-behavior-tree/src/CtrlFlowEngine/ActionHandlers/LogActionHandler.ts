/**
 * Log Action Handler
 *
 * Handles logging messages during test execution
 */

import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { ExecutionContext, BehaviorResult } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType, LogConfig } from '../types';

/**
 * Handler for Log action
 *
 * Logs a message with the specified level
 */
export class LogActionHandler implements ActionHandler<CtrlFlowNodeType, LogConfig> {
  constructor(private logs?: string[]) {}

  async execute(context: ExecutionContext<CtrlFlowNodeType, LogConfig>): Promise<BehaviorResult> {
    const { node } = context;
    const config = node.Config;

    try {
      const level = config.level || 'info';
      const message = config.message;
      const logMessage = `[${level.toUpperCase()}] [${node.Key}] ${message}`;

      // Collect log if logs array provided
      if (this.logs) {
        this.logs.push(logMessage);
      }

      // Log based on level
      switch (level) {
        case 'error':
          console.error(logMessage);
          break;
        case 'warn':
          console.warn(logMessage);
          break;
        case 'debug':
          console.debug(logMessage);
          break;
        case 'info':
        default:
          console.log(logMessage);
          break;
      }

      return BehaviorResult.Success;
    } catch (error) {
      console.error(`Log failed for node ${node.Key}:`, error);
      return BehaviorResult.Failure;
    }
  }
}
