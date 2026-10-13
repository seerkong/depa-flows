import { expect, test } from 'bun:test';
import { applyFlowControlOptions, FlowExecutionError, loadFlowBundleFromSources, runInstantCtrlFlowSpec } from '../src/browser.js';

function definition() {
  return loadFlowBundleFromSources({ 'manifest.xnl': `<InstantCtrlFlow #test.Budgets apiVersion="depa.flows/v1" version="1" (<FlowContract #test.Budgets>) [
    <Until #loop {when="vfs://./code.ts#done" maxIterations=1} [<Run #work {src="vfs://./code.ts#work"}>]>
  ]>` }).spec!;
}

test('per-run override changes the actual loop budget and complete/fail policy without mutating the template', async () => {
  const original = definition(); const before = JSON.stringify(original);
  for (const complete of [false, true]) {
    let calls = 0;
    const spec = applyFlowControlOptions(original, { loop: { maxIterations: 3, onExhausted: complete ? 'complete' : 'fail' } });
    const execution = runInstantCtrlFlowSpec(spec, { input: 0, resolveCode: ({ reference }) => (_runtime, input) => {
      if (reference.endsWith('#done')) return false;
      calls++; return Number(input) + 1;
    } });
    if (complete) expect(await execution).toBe(3);
    else {
      const error: unknown = await execution.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(FlowExecutionError);
      if (!(error instanceof FlowExecutionError) || !(error.cause instanceof Error)) throw error;
      expect(error.cause.message).toContain('max iterations');
    }
    expect(calls).toBe(3);
  }
  let oldCalls = 0;
  await expect(runInstantCtrlFlowSpec(original, { resolveCode: ({ reference }) => () => {
    if (reference.endsWith('#done')) return false;
    oldCalls++; return 0;
  } })).rejects.toThrow('failed');
  expect(oldCalls).toBe(1);
  expect(JSON.stringify(original)).toBe(before);
  expect(applyFlowControlOptions(original, undefined)).toEqual(original);
});

test('control overrides reject wrong nodes, unknown fields, noninteger budgets and over 64 entries', () => {
  const spec = definition();
  for (const value of [{ loop: { maxIterations: 0 } }, { loop: { maxIterations: 1001 } }, { loop: { maxIterations: 1.5 } }, { loop: { onExhausted: 'success' } }, { loop: { concurrency: 2 } }, { missing: { maxIterations: 1 } }, { work: { maxIterations: 1 } }, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`n${i}`, { maxIterations: 1 }]))]) {
    expect(() => applyFlowControlOptions(spec, value)).toThrow();
  }
  expect(applyFlowControlOptions(spec, { loop: { maxIterations: 1000 } }).statements[0].attrs.maxIterations).toBe(1000);
});

test('strict loader rejects invalid Map capacity and exhausted policy before execution', () => {
  for (const declaration of ['<Until #loop {when="vfs://./code.ts#done" onExhausted="pass"} []>', '<ForEach #map {when="vfs://./code.ts#items" maxItems=1001} []>', '<ForEach #map {when="vfs://./code.ts#items" maxItems=1 concurrency=2} []>', '<ForEach #map {when="vfs://./code.ts#items" concurrency=33} []>']) {
    const result = loadFlowBundleFromSources({ 'manifest.xnl': `<InstantCtrlFlow #test.Invalid apiVersion="depa.flows/v1" version="1" (<FlowContract #test.Invalid>) [${declaration}]` });
    expect(result.diagnostics.length).toBeGreaterThan(0);
  }
});
