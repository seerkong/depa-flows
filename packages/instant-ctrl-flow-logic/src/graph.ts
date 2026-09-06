import {parseXnl} from 'xnl-core';
import {lowerPortControlGraph, type PortControlGraph, type StructuredStatement} from 'port-control-graph-logic';
import type {FlowBundleSpec, FlowNodeSpec} from 'instant-ctrl-flow-contract';
import {loadFlowBundleFromSources} from './loader';

// Only the concrete adapter knows XNL. The generic helper accepts arbitrary carrier types.
function project(el:any):FlowNodeSpec {
 const sections=Object.fromEntries(Object.values(el.extend?.children??{}).map((s:any)=>[s.tag,project(s)]));
 return {tag:el.tag,id:el.id?[...(el.id.namespace??[]),el.id.name].join('.'):undefined,metadata:{...el.metadata},attrs:{...el.attributes},children:(el.body??[]).filter((n:any)=>n.kind==='DataElement').map(project),sections};
}
export interface CtrlGraphDocument {root:FlowNodeSpec;graph:PortControlGraph<FlowNodeSpec,string,string,string>}
export function parseCtrlFlowGraph(source:string):CtrlGraphDocument {
 const parsed=parseXnl(source);if(parsed.warnings?.length)throw Error(`graph parser warnings: ${JSON.stringify(parsed.warnings)}`);
 const roots=parsed.nodes.filter((n:any)=>n.kind==='DataElement').map(project);
 if(roots.length!==1||roots[0].tag!=='CtrlFlowGraph')throw Error('expected one CtrlFlowGraph root');
 const root=roots[0];if(root.attrs.targetForm!=='InstantCtrlFlow')throw Error('only InstantCtrlFlow graph profile is supported');
 const endpoint=(s:unknown)=>{const m=typeof s==='string'&&/^port:\/\/#([-\w.]+)\/([-\w.]+)$/.exec(s);if(!m)throw Error(`invalid port URI: ${s}`);return {node:m[1],port:m[2]};};
 const entry=String(root.attrs.entry??'');const m=/^(?:ctrl-node:\/\/#)?([-\w.]+)$/.exec(entry);if(!m)throw Error('invalid graph entry');
 return {root,graph:{entry:m[1],nodes:root.sections.Nodes?.children??[],edges:(root.sections.Edges?.children??[]).map(e=>{if(e.tag!=='Edge'||!e.id)throw Error('Edges requires named Edge');return{id:e.id,from:endpoint(e.attrs.from),to:endpoint(e.attrs.to)};})}};
}
export const ctrlGraphRuntime={
 nodeId:(n:FlowNodeSpec)=>{if(!n.id)throw Error('graph node requires identity');return n.id;},
 shape:(n:FlowNodeSpec)=>{
  const base={enter:'enter',next:'next'};
  if(n.tag==='Run')return {...base,role:'step' as const};
  if(n.tag==='Return')return {...base,role:'exit' as const};
  if(n.tag==='Until')return {...base,role:'loop' as const,body:'body'};
  if(n.tag==='If')return {...base,role:'choice' as const,branches:(n.sections.Ports?.children??[]).map(p=>({port:p.id??'',order:Number(p.attrs.order),default:p.attrs.default===true}))};
  throw Error(`unsupported graph node ${n.tag}`);
 }
};
function xnlValue(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(xnlValue).join(', ')+']';
 if(value&&typeof value==='object')return '{ '+Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>`${JSON.stringify(k)} = ${xnlValue(v)}`).join(' ')+' }';
 return JSON.stringify(value);
}
export function serializeFlowNode(node:FlowNodeSpec):string {
 const attributes=Object.entries(node.attrs).filter(([,v])=>v!==undefined).map(([k,v])=>`${k} = ${xnlValue(v)}`).join('\n');
 const metadata=Object.entries(node.metadata).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join(' ');
 const sections=Object.values(node.sections).map(serializeFlowNode).join('\n');
 return `<${node.tag}${node.id?' #'+node.id:''}${metadata?' '+metadata:''}${attributes?' {\n'+attributes+'\n}':''}${sections?' (\n'+sections+'\n)':''}${node.children.length?' [\n'+node.children.map(serializeFlowNode).join('\n')+'\n]':''}>`;
}
export function compileCtrlFlowGraph(source:string,options:{baseUri?:string}={}):{source:string;spec:FlowBundleSpec;provenance:Record<string,string>;inferredNext:readonly {owner:string;next:string}[]} {
 const doc=parseCtrlFlowGraph(source);const result=lowerPortControlGraph(ctrlGraphRuntime,doc.graph);
 if(!result.ok)throw Error(JSON.stringify(result.diagnostics));
 const provenance:Record<string,string>={};const ids=new Set<string>();
 const identity=(sourceId:string,path:string)=>{let id=sourceId;if(ids.has(id))id=`${sourceId}__${path.replace(/[^\w]/g,'_')}`;ids.add(id);provenance[id]=sourceId;return id;};
 const blank=(tag:string,id?:string,attrs:Record<string,unknown>={},children:FlowNodeSpec[]=[]):FlowNodeSpec=>({tag,id,attrs,metadata:{},children,sections:{}});
 const lower=(statements:readonly StructuredStatement<FlowNodeSpec,string,string>[],path:string):FlowNodeSpec[]=>statements.map((s,index)=>{
  const p=`${path}_${index}`;
  if(s.kind==='block-ref')return blank('RunBlock',identity(`${s.source}__ref`,p),{block:`block://#block_${s.block}`});
  const n:FlowNodeSpec={...s.node,id:identity(s.node.id!,p),attrs:{...s.node.attrs},sections:{},children:[]};
  if(s.kind==='choice')n.sections.Branches=blank('Branches',undefined,{},s.branches.map(b=>{
   const port=s.node.sections.Ports.children.find(p=>p.id===b.port)!;
   return blank(port.attrs.default===true?'Otherwise':'Branch',port.attrs.default===true?undefined:identity(`${s.node.id}_${b.port}`,p),port.attrs.default===true?{}:{when:port.attrs.when,config:port.attrs.config},lower(b.body,`${p}_${b.port}`));
  }));
  if(s.kind==='loop')n.children=lower(s.body,`${p}_body`);
  return n;
 });
 const root:FlowNodeSpec={...doc.root,tag:'InstantCtrlFlow',attrs:{title:doc.root.attrs.title},sections:{...doc.root.sections},children:lower(result.forest.statements,'main')};
 delete root.sections.Nodes;delete root.sections.Edges;delete root.sections.Regions;
 root.sections.Blocks=blank('Blocks',undefined,{},result.forest.blocks.map(b=>blank('Block',`block_${b.id}`,{},lower(b.statements,`block_${b.id}`))));
 const output=serializeFlowNode(root);const loaded=loadFlowBundleFromSources({'flow.xnl':output},options);
 if(!loaded.spec||loaded.diagnostics.length)throw Error(`invalid graph output: ${JSON.stringify(loaded.diagnostics)}`);
 return {source:output,spec:loaded.spec,provenance,inferredNext:result.forest.inferredNext};
}
