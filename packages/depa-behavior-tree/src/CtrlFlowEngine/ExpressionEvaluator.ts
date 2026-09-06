/**
 * Expression Evaluator
 *
 * Safely evaluates JavaScript expressions in a controlled context
 */

import { BehaviorTreeData, INodeConfig } from '../BehaviorTreeCore';

const RESERVED = new Set('await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof var void while with yield implements interface package private protected public static'.split(' '));

/**
 * Evaluate JavaScript expression with access to behavior tree variables
 */
export function evaluateExpression<TNodeType, TConfig extends INodeConfig>(
  expr: string,
  btData: BehaviorTreeData<TNodeType, TConfig>,
  _nodeKey: string
): any {
  try {
    // Create evaluation context with variables
    const context: Record<string, any> = {};

    // Add all variables to context
    btData.Vars.forEach((value, key) => {
      // Engine cursor keys are not JavaScript parameter names; access them through getVar.
      if (/^[A-Za-z_$][\w$]*$/.test(key) && !RESERVED.has(key)) context[key] = value;
    });

    // Helper functions
    context.getVar = (key: string) => btData.Vars.get(key);
    context.setVar = (key: string, value: any) => btData.Vars.set(key, value);

    // Create function from expression
    const func = new Function(...Object.keys(context), `return (${expr});`);

    // Execute with context values
    return func(...Object.values(context));
  } catch (error) {
    console.error(`Error evaluating expression "${expr}":`, error);
    return false;
  }
}

/**
 * Evaluate expression and cast to boolean
 */
export function evaluateCondition<TNodeType, TConfig extends INodeConfig>(
  expr: string,
  btData: BehaviorTreeData<TNodeType, TConfig>,
  _nodeKey: string
): boolean {
  const result = evaluateExpression(expr, btData, _nodeKey);
  return Boolean(result);
}
