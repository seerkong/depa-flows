import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { BehaviorResult, ExecutionContext } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType } from '../types';
import { SelectElementConfig } from './BrowserRuntimeHelpers';
import {
  getBrowserRuntime,
  getDefaultTimeout,
  setNodeError,
} from './BrowserRuntimeHelpers';

export class SelectElementActionHandler implements ActionHandler<CtrlFlowNodeType, SelectElementConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, SelectElementConfig>): Promise<BehaviorResult> {
    try {
      const runtime = getBrowserRuntime(context.runtime);
      if (!runtime || typeof runtime.sideEffect?.selectElement !== 'function') {
        return BehaviorResult.Failure;
      }

      // Auto-wait for element before selecting if waitForElement is available
      if (typeof runtime.sideEffect.waitForElement === 'function') {
        const timeout = getDefaultTimeout(runtime);
        await runtime.sideEffect.waitForElement(context.node.Config.selector, { timeout });
      }

      await runtime.sideEffect.selectElement(
        context.node.Config.selector,
        context.node.Config.checked,
        context.node.Config.retry
      );
      return BehaviorResult.Success;
    } catch (error) {
      setNodeError(context, error, 'SelectElement action failed');
      return BehaviorResult.Failure;
    }
  }
}
