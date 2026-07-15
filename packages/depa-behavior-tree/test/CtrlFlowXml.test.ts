import { describe, it, expect } from 'bun:test';
import { CtrlFlowBuilder } from '../src/CtrlFlowEngine/CtrlFlowBuilder';
import {
  loadCtrlFlowFromXml,
  CtrlFlowXmlAggregateError,
  stringifyCtrlFlowToXml,
} from '../src/CtrlFlowEngine/CtrlFlowXml';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';

describe('CtrlFlowXml', () => {
  it('loads xml to ctrlflow tree and executes', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Sequence key="root" name="main">
  <SubNodes>
    <SetVariable key="set-step">
      <Config><![CDATA[
      {
        "variableName": "step",
        "value": 1
      }
      ]]></Config>
    </SetVariable>
    <Sleep>
      <Config><![CDATA[
      {
        "duration": 1
      }
      ]]></Config>
    </Sleep>
    <Log>
      <Config><![CDATA[
      {
        "message": "done"
      }
      ]]></Config>
    </Log>
  </SubNodes>
</Sequence>`;

    const tree = loadCtrlFlowFromXml(xml);
    const engine = new CtrlFlowEngine();
    const result = await engine.runTest(tree);

    expect(tree.Key).toBe('root');
    expect(tree.Name).toBe('main');
    expect(tree.Attr).toEqual({ key: 'root', name: 'main' });
    expect(tree.Children[2].Type).toBe('Log');
    expect(result.success).toBe(true);
    expect(result.variables.step).toBe(1);
  });

  it('aggregates multiple xml issues in one error', () => {
    const invalidXml = `
<Sequence>
  <Config><![CDATA[
  {
  }
  ]]></Config>
  <SubNodes>
    <UnknownNode />
    <Sleep>
      <Config><![CDATA[
      {
        "duration": "oops"
      }
      ]]></Config>
    </Sleep>
    <SetVariable>
      <Config><![CDATA[{invalid json]]></Config>
    </SetVariable>
  </SubNodes>
</Sequence>`;

    try {
      loadCtrlFlowFromXml(invalidXml);
      throw new Error('expected aggregate error');
    } catch (error) {
      expect(error).toBeInstanceOf(CtrlFlowXmlAggregateError);
      const aggregate = error as CtrlFlowXmlAggregateError;
      expect(aggregate.issues.length).toBeGreaterThanOrEqual(3);
      expect(aggregate.issues.some((issue) => issue.code === 'UNKNOWN_NODE_TYPE')).toBe(true);
      expect(aggregate.issues.some((issue) => issue.code === 'TYPE_MISMATCH')).toBe(true);
      expect(aggregate.issues.some((issue) => issue.code === 'INVALID_CONFIG_JSON')).toBe(true);
    }
  });

  it('stringifies config with prettify json in CDATA', () => {
    const tree = CtrlFlowBuilder.node(
      'SetVariable' as any,
      { key: 'n1', name: 'node-1' },
      {
        variableName: 'payload',
        value: {
          a: 1,
          b: true,
        },
      }
    );

    const xml = stringifyCtrlFlowToXml(tree);

    expect(xml).toContain('<Config><![CDATA[');
    expect(xml).toMatch(/\n\s+"variableName": "payload"/);
    expect(xml).toMatch(/\n\s+"a": 1/);
    expect(xml).toContain('\n      }');
  });

  it('omits Config tag when node config is empty', () => {
    const tree = CtrlFlowBuilder.sequence(
      CtrlFlowBuilder.setVariable('x', 1)
    );

    const xml = stringifyCtrlFlowToXml(tree, { includeXmlDeclaration: false });

    expect(xml).toMatch(/<Sequence>\n\s*<SubNodes>/);
    expect(xml).not.toMatch(/<Sequence>\n\s*<Config><!\[CDATA\[/);
    expect(xml).toContain('<SetVariable>');
    expect(xml).toContain('<Config><![CDATA[');
  });
});
