import { describe, it, expect } from 'bun:test';
import { BehaviorTreeNodeKind } from '../src/BehaviorTreeCore';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';
import { CtrlFlowNodeType } from '../src/CtrlFlowEngine/types';

describe('CtrlFlowDsl', () => {
  it('proxies generic node construction', () => {
    const node = CtrlFlowDsl.node(
      CtrlFlowNodeType.SetVariable,
      { key: 'n1', name: 'set' },
      { variableName: 'step', value: 1 }
    );

    expect(node.Type).toBe(CtrlFlowNodeType.SetVariable);
    expect(node.Key).toBe('n1');
    expect(node.Name).toBe('set');
    expect(node.Attr).toEqual({ key: 'n1', name: 'set' });
  });

  it('builds sequence, selector and until with child nodes', () => {
    const child = CtrlFlowDsl.log('child');

    const sequence = CtrlFlowDsl.sequence(child);
    expect(sequence.Kind).toBe(BehaviorTreeNodeKind.Sequence);
    expect(sequence.Children).toHaveLength(1);

    const selector = CtrlFlowDsl.selector(child);
    expect(selector.Kind).toBe(BehaviorTreeNodeKind.Selector);
    expect(selector.Children).toHaveLength(1);

    const until = CtrlFlowDsl.until('count > 1', child);
    expect(until.Kind).toBe(BehaviorTreeNodeKind.Until);
    expect((until.Config as any).expression).toBe('count > 1');
    expect(until.Children).toHaveLength(1);
  });

  it('builds condition shortcuts', () => {
    const condition = CtrlFlowDsl.condition('x === 1', { key: 'cond' });
    expect(condition.Type).toBe(CtrlFlowNodeType.Condition);
    expect((condition.Config as any).expression).toBe('x === 1');

    const checkExpression = CtrlFlowDsl.checkExpression('y > 2');
    expect(checkExpression.Type).toBe(CtrlFlowNodeType.CheckExpression);
    expect((checkExpression.Config as any).expression).toBe('y > 2');

    const checkVariable = CtrlFlowDsl.checkVariable('step', 2, 'notEquals');
    expect(checkVariable.Type).toBe(CtrlFlowNodeType.CheckVariable);
    expect((checkVariable.Config as any).expression).toBe('step !== 2');
  });

  it('supports setVariable shortcut with concise args', () => {
    const node = CtrlFlowDsl.setVariable('step', 1, { name: 'set-1' });
    expect(node.Type).toBe(CtrlFlowNodeType.SetVariable);
    expect((node.Config as any).variableName).toBe('step');
    expect((node.Config as any).value).toBe(1);
    expect(node.Name).toBe('set-1');
  });

  it('builds all core action shortcuts', () => {
    const logNode = CtrlFlowDsl.log('hello', 'warn');
    expect(logNode.Type).toBe(CtrlFlowNodeType.Log);
    expect((logNode.Config as any).level).toBe('warn');

    const assertNode = CtrlFlowDsl.assert('ok === true', 'failed', { logOnFailure: true });
    expect(assertNode.Type).toBe(CtrlFlowNodeType.Assert);
    expect((assertNode.Config as any).errorMessage).toBe('failed');
    expect((assertNode.Config as any).logOnFailure).toBe(true);

    const sleepNode = CtrlFlowDsl.sleep(5);
    expect(sleepNode.Type).toBe(CtrlFlowNodeType.Sleep);
    expect((sleepNode.Config as any).duration).toBe(5);

    const scriptNode = CtrlFlowDsl.runScript('x = 1');
    expect(scriptNode.Type).toBe(CtrlFlowNodeType.RunScript);
    expect((scriptNode.Config as any).script).toBe('x = 1');

    const httpNode = CtrlFlowDsl.httpCall('https://example.com', 'POST', {
      headers: { Authorization: 'Bearer token' },
      body: { hello: 'world' },
      saveResponseTo: 'resp',
    });
    expect(httpNode.Type).toBe(CtrlFlowNodeType.HttpCall);
    expect((httpNode.Config as any).url).toBe('https://example.com');
    expect((httpNode.Config as any).method).toBe('POST');
    expect((httpNode.Config as any).headers.Authorization).toBe('Bearer token');
    expect((httpNode.Config as any).saveResponseTo).toBe('resp');
  });
});
