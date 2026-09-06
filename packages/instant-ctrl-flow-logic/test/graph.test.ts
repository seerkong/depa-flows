import {test,expect} from 'bun:test';
import {compileCtrlFlowGraph} from '../src/graph';
import {runInstantCtrlFlowSpec} from '../src/browser';
const fixture=await Bun.file(new URL('./fixtures/port-graph/diamond.xnl',import.meta.url)).text();
test('real XNL graph compiles and executes ordered diamond for both branches',async()=>{
 const result=compileCtrlFlowGraph(fixture);
 expect(result.spec.statements.map(n=>n.tag)).toEqual(['Run','If','Run','Return']);expect(result.inferredNext).toEqual([{owner:'route',next:'audit'}]);
 for(const accepted of [true,false]){
  const trace:string[]=[];
  const output=await runInstantCtrlFlowSpec(result.spec,{input:{accepted},resolveCode:({reference})=>(_r,x)=>{const name=reference.split('#')[1];trace.push(name);return name==='isAccepted'?(x as any).accepted:x;}});
  expect(output).toEqual({accepted});expect(trace).toEqual(['load','isAccepted',accepted?'charge':'refuse','audit','done']);
 }
});
test('graph partial merge produces Blocks/RunBlock with flow Return retained',async()=>{
 const source=fixture.replace('<Run #load { src = "vfs://./flow-code/review.ts#load" }>','<Run #load { src = "vfs://./flow-code/review.ts#load" }>')
 .replace('<Run #refuse { src = "vfs://./flow-code/review.ts#refuse" }>','<Return #refuse { value = "refused" }>')
 .replace(/<Edge #refuse-audit[^>]+>/,'');
 const result=compileCtrlFlowGraph(source);expect(result.inferredNext).toEqual([]);
 const trace:string[]=[];const output=await runInstantCtrlFlowSpec(result.spec,{input:1,resolveCode:({reference})=>(_r,x)=>{trace.push(reference.split('#')[1]);return reference.endsWith('#isAccepted')?false:x;}});
 expect(output).toBe('refused');expect(trace).toEqual(['load','isAccepted']);
});
