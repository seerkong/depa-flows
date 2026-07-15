import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { BehaviorResult, ExecutionContext } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType } from '../types';
import {
  NavigateConfig,
  getBrowserRuntime,
  resolveTemplateValue,
  setNodeError,
} from './BrowserRuntimeHelpers';

export class NavigateActionHandler implements ActionHandler<CtrlFlowNodeType, NavigateConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, NavigateConfig>): Promise<BehaviorResult> {
    try {
      const runtime = getBrowserRuntime(context.runtime);
      if (!runtime || typeof runtime.sideEffect?.navigateTo !== 'function') {
        return BehaviorResult.Failure;
      }

      const resolvedUrl = resolveTemplateValue(context.node.Config.url, context);
      await runtime.sideEffect.navigateTo(resolvedUrl);
      if (typeof runtime.sideEffect.waitForPageLoad === 'function') {
        await runtime.sideEffect.waitForPageLoad();
      }
      return BehaviorResult.Success;
    } catch (error) {
      setNodeError(context, error, 'Navigate action failed');
      return BehaviorResult.Failure;
    }
  }
}
