import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { BehaviorResult, ExecutionContext } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType } from '../types';
import { WaitForElementConfig } from './BrowserRuntimeHelpers';
import { getBrowserRuntime, setNodeError } from './BrowserRuntimeHelpers';

export class WaitForElementActionHandler implements ActionHandler<CtrlFlowNodeType, WaitForElementConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, WaitForElementConfig>): Promise<BehaviorResult> {
    try {
      const runtime = getBrowserRuntime(context.runtime);
      if (!runtime || typeof runtime.sideEffect?.waitForElement !== 'function') {
        return BehaviorResult.Failure;
      }
      await runtime.sideEffect.waitForElement(context.node.Config.selector, {
        timeout: context.node.Config.timeout,
        interval: context.node.Config.interval,
      });
      return BehaviorResult.Success;
    } catch (error) {
      setNodeError(context, error, 'WaitForElement action failed');
      return BehaviorResult.Failure;
    }
  }
}
