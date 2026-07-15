import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { BehaviorResult, ExecutionContext } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType } from '../types';
import {
  ClickConfig,
  getBrowserRuntime,
  getDefaultTimeout,
  setNodeError,
} from './BrowserRuntimeHelpers';

export class ClickActionHandler implements ActionHandler<CtrlFlowNodeType, ClickConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, ClickConfig>): Promise<BehaviorResult> {
    try {
      const runtime = getBrowserRuntime(context.runtime);
      if (!runtime || typeof runtime.sideEffect?.clickElement !== 'function') {
        return BehaviorResult.Failure;
      }

      // Auto-wait for element before clicking if waitForElement is available
      if (typeof runtime.sideEffect.waitForElement === 'function') {
        const timeout = getDefaultTimeout(runtime);
        await runtime.sideEffect.waitForElement(context.node.Config.selector, { timeout });
      }

      await runtime.sideEffect.clickElement(context.node.Config.selector, context.node.Config.retry);
      return BehaviorResult.Success;
    } catch (error) {
      setNodeError(context, error, 'Click action failed');
      return BehaviorResult.Failure;
    }
  }
}
