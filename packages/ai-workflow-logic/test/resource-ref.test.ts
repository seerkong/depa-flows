import { describe, expect, test } from 'bun:test';
import {
  assertAIWorkflowResourceRef,
  isAIWorkflowResourceRef,
  parseAIWorkflowResourceRef,
} from 'ai-workflow-logic';

describe('AI workflow resource refs', () => {
  test.each([
    'vfs://./workflow/manifest.xnl',
    'vfs://@/shared/resources/catalog.xnl',
    'resource://depa.flows.demo.AgentWorkflow',
    'config://#model/default',
    'secret://ai-provider/api-key',
  ])('accepts containment-safe logical ref %s', (ref) => {
    expect(isAIWorkflowResourceRef(ref)).toBe(true);
    expect(assertAIWorkflowResourceRef(ref)).toBe(ref);
    expect(parseAIWorkflowResourceRef(ref)?.target).toBe(ref.slice(ref.indexOf('://') + 3));
  });

  test.each([
    'host-absolute-path',
    './workflow/manifest.xnl',
    '../workflow/manifest.xnl',
    'file://host/app',
    'http://example.com/resource',
    'vfs:///host/app',
    'vfs://../escape.xnl',
    'vfs://.%2e/escape.xnl',
    'vfs://folder\\escape.xnl',
    'resource://../escape',
    'config://..',
  ])('rejects unsafe or unregistered ref %s', (ref) => {
    expect(isAIWorkflowResourceRef(ref)).toBe(false);
    expect(() => assertAIWorkflowResourceRef(ref)).toThrow('invalid AI workflow resource ref');
  });
});
