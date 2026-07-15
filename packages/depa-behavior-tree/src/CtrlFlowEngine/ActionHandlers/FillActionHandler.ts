import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { BehaviorResult, ExecutionContext } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType } from '../types';
import {
  FillConfig,
  getBrowserRuntime,
  getDefaultTimeout,
  resolveTemplateValue,
  setNodeError,
} from './BrowserRuntimeHelpers';

export class FillActionHandler implements ActionHandler<CtrlFlowNodeType, FillConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, FillConfig>): Promise<BehaviorResult> {
    try {
      const runtime = getBrowserRuntime(context.runtime);
      if (!runtime || typeof runtime.sideEffect?.fillInput !== 'function') {
        return BehaviorResult.Failure;
      }

      // Auto-wait for element before filling if waitForElement is available
      if (typeof runtime.sideEffect.waitForElement === 'function') {
        const timeout = getDefaultTimeout(runtime);
        await runtime.sideEffect.waitForElement(context.node.Config.selector, { timeout });
      }

      const resolvedValue = resolveTemplateValue(context.node.Config.value, context);
      await runtime.sideEffect.fillInput(context.node.Config.selector, resolvedValue, context.node.Config.retry);
      return BehaviorResult.Success;
    } catch (error) {
      setNodeError(context, error, 'Fill action failed');
      return BehaviorResult.Failure;
    }
  }
}
