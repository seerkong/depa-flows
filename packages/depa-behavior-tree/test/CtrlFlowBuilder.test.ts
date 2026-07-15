import { describe, it, expect } from 'bun:test';
import { BehaviorTreeNodeKind, BehaviorTreeNodeStatus } from '../src/BehaviorTreeCore';
import { CtrlFlowNodeType } from '../src/CtrlFlowEngine/types';
import { CtrlFlowBuilder } from '../src/CtrlFlowEngine/CtrlFlowBuilder';

describe('CtrlFlowBuilder', () => {
  it('builds action node with unified signature', () => {
    const node = CtrlFlowBuilder.node(
      CtrlFlowNodeType.SetVariable,
      { key: 'k1', name: 'set var' },
      { variableName: 'step', value: 1 }
    );

    expect(node.Kind).toBe(BehaviorTreeNodeKind.Action);
    expect(node.Type).toBe(CtrlFlowNodeType.SetVariable);
    expect(node.Key).toBe('k1');
    expect(node.Name).toBe('set var');
    expect(node.Status).toBe(BehaviorTreeNodeStatus.Init);
  });

  it('allows omitting key and name metadata', () => {
    const node = CtrlFlowBuilder.node(CtrlFlowNodeType.Sleep, undefined, { duration: 10 });

    expect(node.Kind).toBe(BehaviorTreeNodeKind.Action);
    expect(node.Type).toBe(CtrlFlowNodeType.Sleep);
    expect(typeof node.Key).toBe('string');
    expect(node.Key.length).toBeGreaterThan(0);
    expect(node.Name).toBeUndefined();
  });

  it('builds control node with child nodes', () => {
    const child = CtrlFlowBuilder.node(CtrlFlowNodeType.Log, undefined, { message: 'ok' });
    const node = CtrlFlowBuilder.node(CtrlFlowNodeType.Sequence, undefined, {}, [child]);

    expect(node.Kind).toBe(BehaviorTreeNodeKind.Sequence);
    expect(node.Children).toHaveLength(1);
    expect(node.Children[0].Type).toBe(CtrlFlowNodeType.Log);
  });

  it('generates fallback key for empty meta key and keeps explicit attr fields', () => {
    const node = CtrlFlowBuilder.node(
      CtrlFlowNodeType.Log,
      { key: '', name: '' },
      { message: 'hello' }
    );

    expect(node.Key).toMatch(/^log_/);
    expect(node.Name).toBe('');
    expect(node.Attr).toEqual({ key: '', name: '' });
  });

  it('rejects action nodes with subNodes', () => {
    const child = CtrlFlowBuilder.log('child');
    expect(() =>
      CtrlFlowBuilder.node(CtrlFlowNodeType.Log, undefined, { message: 'root' }, [child])
    ).toThrow('action node cannot contain subNodes');
  });

  it('builds control shortcuts', () => {
    const child = CtrlFlowBuilder.log('child');

    const sequence = CtrlFlowBuilder.sequence({ key: 'seq' }, [child]);
    expect(sequence.Kind).toBe(BehaviorTreeNodeKind.Sequence);
    expect(sequence.Key).toBe('seq');
    expect(sequence.Children).toHaveLength(1);

    const selector = CtrlFlowBuilder.selector(undefined, [child]);
    expect(selector.Kind).toBe(BehaviorTreeNodeKind.Selector);
    expect(selector.Children).toHaveLength(1);

    const until = CtrlFlowBuilder.until('attempts > 3', [child], { name: 'u' });
    expect(until.Kind).toBe(BehaviorTreeNodeKind.Until);
    expect((until.Config as any).expression).toBe('attempts > 3');
    expect(until.Name).toBe('u');
  });

  it('builds condition shortcuts', () => {
    const condition = CtrlFlowBuilder.condition('x === 1', { key: 'cond' });
    expect(condition.Kind).toBe(BehaviorTreeNodeKind.Condition);
    expect(condition.Key).toBe('cond');
    expect((condition.Config as any).expression).toBe('x === 1');

    const checkExpression = CtrlFlowBuilder.checkExpression('y > 2');
    expect((checkExpression.Config as any).expression).toBe('y > 2');
  });

  it('builds checkVariable expressions for all operators', () => {
    const cases: Array<[any, string]> = [
      ['equals', 'step === 1'],
      ['notEquals', 'step !== 1'],
      ['greaterThan', 'step > 1'],
      ['lessThan', 'step < 1'],
      ['exists', 'typeof step !== "undefined"'],
      ['notExists', 'typeof step === "undefined"'],
    ];

    cases.forEach(([operator, expectedExpr]) => {
      const node = CtrlFlowBuilder.checkVariable('step', 1, operator);
      expect((node.Config as any).expression).toBe(expectedExpr);
    });
  });

  it('builds core action shortcuts', () => {
    const setVariable = CtrlFlowBuilder.setVariable('step', 2, { key: 'set' });
    expect(setVariable.Type).toBe(CtrlFlowNodeType.SetVariable);
    expect((setVariable.Config as any).variableName).toBe('step');

    const log = CtrlFlowBuilder.log('hello', 'warn');
    expect((log.Config as any).level).toBe('warn');

    const assertNode = CtrlFlowBuilder.assert('x === 1', 'bad', { logOnFailure: true });
    expect((assertNode.Config as any).errorMessage).toBe('bad');
    expect((assertNode.Config as any).logOnFailure).toBe(true);

    const sleep = CtrlFlowBuilder.sleep(5);
    expect((sleep.Config as any).duration).toBe(5);

    const runScript = CtrlFlowBuilder.runScript('x = 1');
    expect((runScript.Config as any).script).toBe('x = 1');

    const httpCall = CtrlFlowBuilder.httpCall('https://example.com', 'POST', {
      headers: { Authorization: 'Bearer token' },
      body: { ok: true },
      saveResponseTo: 'resp',
    });
    expect((httpCall.Config as any).method).toBe('POST');
    expect((httpCall.Config as any).headers.Authorization).toBe('Bearer token');
    expect((httpCall.Config as any).saveResponseTo).toBe('resp');

    const httpCallWithoutOptions = CtrlFlowBuilder.httpCall('https://example.com', 'GET');
    expect((httpCallWithoutOptions.Config as any).method).toBe('GET');
  });

  it('builds extension node types via generic node()', () => {
    // Extension node types can be built using the generic node() method
    // even though they don't have dedicated shortcut methods
    const node = CtrlFlowBuilder.node('CustomAction' as any, { key: 'custom-1' }, { foo: 'bar' });
    expect(node.Type).toBe('CustomAction');
    expect(node.Kind).toBe(BehaviorTreeNodeKind.Action); // default for unknown types
    expect(node.Key).toBe('custom-1');
  });
});
