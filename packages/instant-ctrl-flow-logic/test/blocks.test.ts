import {expect,test} from 'bun:test';
import {loadInstantCtrlFlowSources,runInstantCtrlFlowSources} from '../src/browser';
const source=(body:string,block:string)=>({'flow.xnl':`<InstantCtrlFlow #test.Blocks apiVersion="depa.flows/v1" version="1.0.0" (<FlowContract #test.Blocks { input="vfs://./c.ts#Input" output="vfs://./c.ts#Output" }><Blocks [${block}]>) [${body}]>`});
const call='<RunBlock #call { block="block://#shared" }>';
const run='<Run #work { src="vfs://./code.ts#work" }>';
test('RunBlock updates caller current and naturally continues',async()=>{
 const trace:string[]=[];const r=await runInstantCtrlFlowSources(source(`${call}<RunBlock #again { block="block://#shared" }>`,`<Block #shared [${run}]>`),{input:1,resolveCode:()=> (_r,x)=>{trace.push('work');return Number(x)+1;}});expect(r).toBe(3);expect(trace).toEqual(['work','work']);
});
test('block Return exits caller; block fault propagates without running caller next',async()=>{
 const trace:string[]=[];const after='<Run #after {src="vfs://./code.ts#after"}>';
 const resolveCode=({reference:ref}:{reference:string})=> (_r:unknown,x:unknown)=>{trace.push(ref.split('#')[1]);if(ref.endsWith('#fail'))throw Error('boom');return x;};
 expect(await runInstantCtrlFlowSources<unknown>(source(call+after,'<Block #shared [<Return #return {value=9}>]>'),{resolveCode,input:1})).toBe(9);expect(trace).toEqual([]);
 await expect(runInstantCtrlFlowSources<unknown>(source(call+after,'<Block #shared [<Run #fail {src="vfs://./code.ts#fail"}>]>'),{resolveCode})).rejects.toThrow();expect(trace).toEqual(['fail']);
});
test('RunBlock in Until reads and updates caller loop value',async()=>{
 const body=`<Until #loop {when="vfs://./code.ts#done" maxIterations=4} [${call}]><Return #out>`;
 const r=await runInstantCtrlFlowSources(source(body,`<Block #shared [${run}]>`),{input:0,resolveCode:({reference:ref})=> (_r,x)=>ref.endsWith('#done')?Number(x)>=3:Number(x)+1});expect(r).toBe(3);
});
test('unresolved/recursive block references rejected',()=>{
 expect(()=>loadInstantCtrlFlowSources(source(call,''))).toThrow();
 expect(()=>loadInstantCtrlFlowSources(source(call,`<Block #shared [<RunBlock #cycle {block="block://#shared"}>]>`))).toThrow();
});
