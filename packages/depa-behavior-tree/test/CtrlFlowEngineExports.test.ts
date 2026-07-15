import { describe, it, expect } from 'bun:test';
import {
  CtrlFlowBuilder,
  CtrlFlowDsl,
} from '../src/CtrlFlowEngine';

describe('CtrlFlowEngine package exports', () => {
  it('exports CtrlFlowBuilder and CtrlFlowDsl', () => {
    expect(CtrlFlowBuilder).toBeDefined();
    expect(CtrlFlowDsl).toBeDefined();
  });
});
