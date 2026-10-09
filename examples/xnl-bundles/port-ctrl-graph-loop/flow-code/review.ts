import type { OrderInput, OrderResult } from "./review.contracts";
export interface DemoRuntime { trace: string[] }
function action(name: string, runtime: DemoRuntime, input: OrderInput): OrderResult {
  runtime.trace.push(name);
  return { ...input, count: (input.count ?? 0) + 1, lastAction: name };
}
export function entry(runtime: DemoRuntime, input: OrderInput) { return { ...action("entry", runtime, input), iteration: input.iteration ?? 0 }; }
export function fast(runtime: DemoRuntime, input: OrderInput) { return action("fast", runtime, input); }
export function slow(runtime: DemoRuntime, input: OrderInput) { return action("slow", runtime, input); }
export function advance(runtime: DemoRuntime, input: OrderInput) { return { ...action("advance", runtime, input), iteration: (input.iteration ?? 0) + 1 }; }
export function finalize(runtime: DemoRuntime, input: OrderInput) { return action("finalize", runtime, input); }
export function done(runtime: DemoRuntime, input: OrderInput): OrderResult { runtime.trace.push("done"); return { ...input, outcome: "loop-completed" }; }
export function doneLoop(runtime: DemoRuntime, input: OrderInput) { runtime.trace.push("doneLoop"); return (input.iteration ?? 0) >= (input.iterations ?? 3); }
export function evenIteration(runtime: DemoRuntime, input: OrderInput) { runtime.trace.push("evenIteration"); return (input.iteration ?? 0) % 2 === 0; }
