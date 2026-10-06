import type { OrderInput, OrderResult } from "./review.contracts";
export interface DemoRuntime { trace: string[] }
function action(name: string, runtime: DemoRuntime, input: OrderInput): OrderResult {
  runtime.trace.push(name);
  return { ...input, count: (input.count ?? 0) + 1, lastAction: name };
}
export function entry(runtime: DemoRuntime, input: OrderInput) { return action("entry", runtime, input); }
export function runA(runtime: DemoRuntime, input: OrderInput) { return action("runA", runtime, input); }
export function runB(runtime: DemoRuntime, input: OrderInput) { return action("runB", runtime, input); }
export function runC(runtime: DemoRuntime, input: OrderInput) { return action("runC", runtime, input); }
export function shared(runtime: DemoRuntime, input: OrderInput) { return action("shared", runtime, input); }
export function routeA(runtime: DemoRuntime, input: OrderInput) { runtime.trace.push("routeA"); return input.route === "A"; }
export function routeB(runtime: DemoRuntime, input: OrderInput) { runtime.trace.push("routeB"); return input.route === "B"; }
export function finishShared(runtime: DemoRuntime, input: OrderInput): OrderResult { runtime.trace.push("finishShared"); return { ...input, outcome: "shared" }; }
export function finishC(runtime: DemoRuntime, input: OrderInput): OrderResult { runtime.trace.push("finishC"); return { ...input, outcome: "C-only" }; }
