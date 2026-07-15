/**
 * RunScript Action Handler
 *
 * Handles execution of JavaScript scripts
 */

import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { ExecutionContext, BehaviorResult, INodeConfig } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType, RunScriptConfig } from '../types';

const RESERVED_NAMES = new Set(['context', 'getVar', 'setVar', 'evalExpression']);

type ScriptScope = Record<string | symbol, any>;

function createScriptScope<TNodeType, TConfig extends INodeConfig>(
  context: ExecutionContext<TNodeType, TConfig>
): ScriptScope {
  const vars = context.btData.Vars;
  const boundGetVar = context.getVar.bind(context);
  const boundSetVar = context.setVar.bind(context);
  const boundEvalExpression = context.evalExpression.bind(context);
  const globalScope = globalThis as Record<string | symbol, any>;

  return new Proxy(
    {},
    {
      has: (_target, prop) => prop !== Symbol.unscopables,
      get: (_target, prop) => {
        if (prop === Symbol.unscopables) {
          return undefined;
        }

        if (prop === 'context') {
          return context;
        }

        if (prop === 'getVar') {
          return boundGetVar;
        }

        if (prop === 'setVar') {
          return boundSetVar;
        }

        if (prop === 'evalExpression') {
          return boundEvalExpression;
        }

        if (typeof prop === 'string') {
          if (vars.has(prop)) {
            return boundGetVar(prop);
          }

          if (prop in globalScope) {
            return globalScope[prop];
          }
        }

        if (typeof prop === 'symbol' && prop in globalScope) {
          return globalScope[prop];
        }

        return undefined;
      },
      set: (_target, prop, value) => {
        if (typeof prop === 'string') {
          if (RESERVED_NAMES.has(prop)) {
            return false;
          }
          boundSetVar(prop, value);
          return true;
        }
        return false;
      },
      deleteProperty: (_target, prop) => {
        if (typeof prop === 'string') {
          return vars.delete(prop);
        }
        return false;
      },
    }
  );
}

/**
 * Handler for RunScript action
 *
 * Executes a JavaScript script with access to context
 */
export class RunScriptActionHandler implements ActionHandler<CtrlFlowNodeType, RunScriptConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, RunScriptConfig>): Promise<BehaviorResult> {
    const { node } = context;
    const config = node.Config;

    try {
      const scope = createScriptScope(context);

      // Create a function from the script
      // The script has access to: context variables, helpers, global scope
      const scriptFunction = new Function(
        'scope',
        `
        return (async () => {
          with (scope) {
            ${config.script}
          }
        })();
        `
      );

      // Execute the script with context
      await scriptFunction(scope);

      return BehaviorResult.Success;
    } catch (error) {
      console.error(`RunScript failed for node ${node.Key}:`, error);
      return BehaviorResult.Failure;
    }
  }
}
