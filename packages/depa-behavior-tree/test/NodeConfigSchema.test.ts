import { describe, it, expect } from 'bun:test';
import { CtrlFlowBuilder } from '../src/CtrlFlowEngine/CtrlFlowBuilder';
import { CtrlFlowNodeType } from '../src/CtrlFlowEngine/types';
import {
  CTRL_FLOW_NODE_CONFIG_SCHEMAS,
  validateNodeConfig,
  registerNodeConfigSchema,
  getNodeConfigSchema,
} from '../src/CtrlFlowEngine/NodeConfigSchema';

describe('NodeConfigSchema', () => {
  it('returns structured issues for invalid config', () => {
    const issues = validateNodeConfig(CtrlFlowNodeType.Sleep, { duration: -1 }, 'node.config');

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toEqual(
      expect.objectContaining({
        code: 'NUMBER_TOO_SMALL',
        path: 'node.config.duration',
      })
    );
  });

  it('is reused by CtrlFlowBuilder', () => {
    expect(() => CtrlFlowBuilder.node(CtrlFlowNodeType.Sleep, undefined, { duration: -10 })).toThrow(
      'Invalid config for node type Sleep'
    );
  });

  it('validates required fields and unknown properties', () => {
    const missing = validateNodeConfig(CtrlFlowNodeType.SetVariable, {}, 'cfg');
    expect(missing.some((issue) => issue.code === 'MISSING_REQUIRED' && issue.path === 'cfg.variableName')).toBe(true);

    const unknown = validateNodeConfig(
      CtrlFlowNodeType.SetVariable,
      { variableName: 'x', value: 1, extra: true },
      'cfg'
    );
    expect(unknown.some((issue) => issue.code === 'UNKNOWN_PROPERTY' && issue.path === 'cfg.extra')).toBe(true);
  });

  it('validates enum, string and boolean constraints', () => {
    const conditionIssues = validateNodeConfig(CtrlFlowNodeType.Condition, { expression: '' }, 'cfg');
    expect(conditionIssues.some((issue) => issue.code === 'STRING_TOO_SHORT' && issue.path === 'cfg.expression')).toBe(true);

    const logIssues = validateNodeConfig(
      CtrlFlowNodeType.Log,
      { message: 1, level: 'trace' },
      'cfg'
    );
    expect(logIssues.some((issue) => issue.code === 'TYPE_MISMATCH' && issue.path === 'cfg.message')).toBe(true);
    expect(logIssues.some((issue) => issue.code === 'ENUM_MISMATCH' && issue.path === 'cfg.level')).toBe(true);

    const assertIssues = validateNodeConfig(
      CtrlFlowNodeType.Assert,
      { expression: 'x === 1', logOnFailure: 'yes' },
      'cfg'
    );
    expect(assertIssues.some((issue) => issue.code === 'TYPE_MISMATCH' && issue.path === 'cfg.logOnFailure')).toBe(true);
  });

  it('validates nested additionalProperties schemas', () => {
    const issues = validateNodeConfig(
      CtrlFlowNodeType.HttpCall,
      {
        url: '/api',
        method: 'POST',
        headers: {
          ok: 'x-token',
          bad: 100,
        },
      },
      'cfg'
    );

    expect(issues.some((issue) => issue.code === 'TYPE_MISMATCH' && issue.path === 'cfg.headers.bad')).toBe(true);
  });

  it('covers array and null schema branches via temporary schema overrides', () => {
    const original = CTRL_FLOW_NODE_CONFIG_SCHEMAS[CtrlFlowNodeType.Sequence];
    try {
      (CTRL_FLOW_NODE_CONFIG_SCHEMAS as any)[CtrlFlowNodeType.Sequence] = {
        type: 'array',
        items: { type: 'number' },
      };

      const arrayIssues = validateNodeConfig(CtrlFlowNodeType.Sequence, [1, 'x'], 'cfg');
      expect(arrayIssues.some((issue) => issue.code === 'TYPE_MISMATCH' && issue.path === 'cfg[1]')).toBe(true);

      (CTRL_FLOW_NODE_CONFIG_SCHEMAS as any)[CtrlFlowNodeType.Sequence] = {
        type: 'null',
      };

      const nullIssues = validateNodeConfig(CtrlFlowNodeType.Sequence, 1, 'cfg');
      expect(nullIssues.some((issue) => issue.code === 'TYPE_MISMATCH' && issue.path === 'cfg')).toBe(true);
    } finally {
      (CTRL_FLOW_NODE_CONFIG_SCHEMAS as any)[CtrlFlowNodeType.Sequence] = original;
    }
  });

  it('supports registering and retrieving extension schemas', () => {
    const customSchema = {
      type: 'object' as const,
      required: ['target'] as readonly string[],
      additionalProperties: false,
      properties: {
        target: { type: 'string' as const, minLength: 1 },
      },
    };

    registerNodeConfigSchema('CustomExtNode', customSchema);
    expect(getNodeConfigSchema('CustomExtNode')).toBe(customSchema);

    const issues = validateNodeConfig('CustomExtNode', { target: '' }, 'cfg');
    expect(issues.some((issue) => issue.code === 'STRING_TOO_SHORT')).toBe(true);

    const validIssues = validateNodeConfig('CustomExtNode', { target: 'ok' }, 'cfg');
    expect(validIssues).toHaveLength(0);
  });

  it('skips validation for unregistered node types', () => {
    const issues = validateNodeConfig('TotallyUnknown', { anything: true }, 'cfg');
    expect(issues).toHaveLength(0);
  });
});
