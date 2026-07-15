import { describe, expect, it } from 'bun:test';
import type {
  FlowBundleSpec,
  FlowCodeFunction,
  FlowForm,
  InstantFlowRunOptions,
  InstantFlowRuntime,
} from '../src/index.js';

type Assert<T extends true> = T;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type LacksKey<T, K extends PropertyKey> = K extends keyof T ? false : true;
type IsExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

const contractAssertions: [
  Assert<IsExact<FlowForm, 'InstantFlow' | 'WorkFlow' | 'BizProcess'>>,
    Assert<HasKey<FlowBundleSpec, 'statements'>>,
    Assert<LacksKey<FlowBundleSpec, 'root'>>,
    Assert<LacksKey<FlowBundleSpec, 'actionTypes'>>,
    Assert<IsExact<InstantFlowRunOptions['input'], unknown>>,
    Assert<IsExact<Parameters<FlowCodeFunction>, [InstantFlowRuntime, unknown, Readonly<Record<string, unknown>>]>>,
] = [true, true, true, true, true, true];

describe('FlowBundleSpec contract', () => {
  it('keeps the three products and exposes only canonical root statements', () => {
    expect(contractAssertions).toEqual([true, true, true, true, true, true]);
  });
});
