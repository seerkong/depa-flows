import type {OrderInput,OrderResult} from './review.contracts';
export interface DemoRuntime {trace:string[]}
function action(name:string,runtime:DemoRuntime,input:OrderInput):OrderResult {runtime.trace.push(name);return {...input,count:(input.count??0)+1,lastAction:name};}
function condition(name:string,runtime:DemoRuntime,input:OrderInput):boolean {runtime.trace.push(name);return Boolean(input[name as 'a'|'b'|'c'|'accepted']);}
export function load(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('load',runtime,input);}
export function entry(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('entry',runtime,input);}
export function charge(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('charge',runtime,input);}
export function refuse(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('refuse',runtime,input);}
export function audit(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('audit',runtime,input);}
export function x(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('x',runtime,input);}
export function shared(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('shared',runtime,input);}
export function other(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('other',runtime,input);}
export function done(runtime:DemoRuntime,input:OrderInput):OrderResult {return action('done',runtime,input);}
export function a(runtime:DemoRuntime,input:OrderInput):boolean {return condition('a',runtime,input);}
export function b(runtime:DemoRuntime,input:OrderInput):boolean {return condition('b',runtime,input);}
export function c(runtime:DemoRuntime,input:OrderInput):boolean {return condition('c',runtime,input);}
export function isAccepted(runtime:DemoRuntime,input:OrderInput):boolean {return condition('accepted',runtime,input);}
export function doneLoop(runtime:DemoRuntime,input:OrderInput):boolean {runtime.trace.push('doneLoop');return (input.count??0)>=2;}
