import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { BehaviorResult, ExecutionContext } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType } from '../types';
import { WaitTimeConfig } from './BrowserRuntimeHelpers';
import { getBrowserRuntime, setNodeError } from './BrowserRuntimeHelpers';

export class WaitTimeActionHandler implements ActionHandler<CtrlFlowNodeType, WaitTimeConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, WaitTimeConfig>): Promise<BehaviorResult> {
    try {
      const runtime = getBrowserRuntime(context.runtime);
      if (runtime && typeof runtime.sideEffect?.wait === 'function') {
        await runtime.sideEffect.wait(context.node.Config.duration);
      } else {
        await new Promise((resolve) => setTimeout(resolve, context.node.Config.duration));
      }
      return BehaviorResult.Success;
    } catch (error) {
      setNodeError(context, error, 'WaitTime action failed');
      return BehaviorResult.Failure;
    }
  }
}
