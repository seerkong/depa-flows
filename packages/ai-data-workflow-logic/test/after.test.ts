import {expect, test} from 'bun:test';
import {applyAIDataWorkflowGraphPatch, createAIDataWorkflowRunGraph, loadAIDataWorkflow, planAIDataWorkflowAfterPatch, recordAIDataWorkflowNodeResult} from '../src/index';
import type {AIDataWorkflowRunGraph} from 'ai-data-workflow-contract';

function graph(): AIDataWorkflowRunGraph {
  const loaded = loadAIDataWorkflow({extensionCodecs: {resolve: () => undefined}}, {sources: {'manifest.xnl': `<AIDataWorkflow #test.After apiVersion="depa.flows/v1" version="1" (<FlowContract #test.After {inputPorts=["input"] outputPorts=["output"]}>) [
<EntryNode #entry>
<TransformNode #plan {inputs={input="flow-port://#entry/input"} outputs=["output"] src="vfs://./code.ts#identity" config={workflowReopenProtected=true}}>
<TransformNode #implement {inputs={plan="flow-port://#plan/output"} outputs=["output"] src="vfs://./code.ts#identity" config={workflowReopenable=true}}>
<TransformNode #review {inputs={implementation="flow-port://#implement/output"} outputs=["output"] src="vfs://./code.ts#identity" config={workflowAfter={schemaVersion="depa.ai-data-after/v1" targetNodeId="implement" resultPort="output" decisionField="verdict" reopenValue="continue" completeValue="complete" maxReopens=1}}}>
<ReturnNode #return {inputs={output="flow-port://#review/output"}}>
]>`}}, {});
  if (!loaded.binding) throw Error(JSON.stringify(loaded.diagnostics));
  let current = createAIDataWorkflowRunGraph({binding: loaded.binding, runId: 'native-after'});
  for (const nodeId of ['entry', 'plan', 'implement', 'review']) current = recordAIDataWorkflowNodeResult(current, nodeId, {nodeId, generation: 0, status: 'Succeeded', output: {output: nodeId === 'review' ? {verdict: 'continue', round: 1, changeRef: 'dirty-original', gaps: [{id: 'gap', evidence: ['actual'], action: 'repair'}]} : {full: '原节点完整正文-' + nodeId}}});
  return current;
}

test('原生 after 只产生有界前序重开补丁，冻结完整反馈与旧代输出且不修改原图', () => {
  const before = graph(), bytes = JSON.stringify(before), patch = planAIDataWorkflowAfterPatch(before, 'review');
  expect(patch).toBeDefined(); expect(JSON.stringify(before)).toBe(bytes);
  const next = applyAIDataWorkflowGraphPatch(before, patch!);
  expect(next.nodes.plan).toEqual(before.nodes.plan); expect(next.nodes.entry).toEqual(before.nodes.entry);
  expect(next.nodes.implement?.generation).toBe(1); expect(next.nodes.review?.generation).toBe(1); expect(next.nodes.return?.generation).toBe(1);
  expect(next.nodes.implement?.status).toBe('Invalidated'); expect(next.nodes.review?.status).toBe('Invalidated');
  expect(next.nodes.implement?.config.afterFeedback).toMatchObject({sourceNode: 'review', sourceGeneration: 0, output: {verdict: 'continue'}, nodeResults: {implement: {output: before.nodes.implement!.result!.output}, review: {output: before.nodes.review!.result!.output}}});
  expect(next.nodes.implement?.dependsOn).toEqual(before.nodes.implement?.dependsOn); expect(next.nodes.review?.dependsOn).toEqual(before.nodes.review?.dependsOn);
  expect(planAIDataWorkflowAfterPatch(next, 'review')).toBeUndefined();
  const second = recordAIDataWorkflowNodeResult(next, 'review', {nodeId: 'review', generation: 1, status: 'Succeeded', output: {output: {verdict: 'continue'}}});
  expect(() => planAIDataWorkflowAfterPatch(second, 'review')).toThrow('AI_DATA_AFTER_BUDGET_EXHAUSTED');
});

test('完成结果零补丁；未知、坏版本、陈旧代次、活跃任务和人审保护均拒绝', () => {
  const original = graph(), source = original.nodes.review!;
  const withReview = (changes: Partial<typeof source>): AIDataWorkflowRunGraph => ({...original, nodes: {...original.nodes, review: {...source, ...changes}}});
  expect(planAIDataWorkflowAfterPatch(withReview({result: {...source.result!, output: {output: {verdict: 'complete'}}}}), 'review')).toBeUndefined();
  expect(() => planAIDataWorkflowAfterPatch(withReview({result: {...source.result!, output: {output: {verdict: 'unknown'}}}}), 'review')).toThrow('AI_DATA_AFTER_DECISION_UNSETTLED');
  expect(() => planAIDataWorkflowAfterPatch(withReview({result: {...source.result!, generation: 4}}), 'review')).toThrow('AI_DATA_AFTER_SOURCE_GENERATION');
  expect(() => planAIDataWorkflowAfterPatch(withReview({config: {...source.config, workflowAfter: {schemaVersion: 'other'}}}), 'review')).toThrow('AI_DATA_AFTER_POLICY_FIELDS');
  expect(() => planAIDataWorkflowAfterPatch({...original, nodes: {...original.nodes, implement: {...original.nodes.implement!, status: 'Running'}}}, 'review')).toThrow('AI_DATA_AFTER_UNSETTLED_NODE');
  const waiting: AIDataWorkflowRunGraph = {...original, nodes: {...original.nodes, implement: {...original.nodes.implement!, status: 'Ready', result: {nodeId: 'implement', generation: 0, status: 'Waiting'}}}};
  expect(() => planAIDataWorkflowAfterPatch(waiting, 'review')).toThrow('AI_DATA_AFTER_UNSETTLED_NODE');
  expect(() => planAIDataWorkflowAfterPatch({...original, nodes: {...original.nodes, review: {...source, config: {...source.config, humanReview: true}}}}, 'review')).toThrow('AI_DATA_AFTER_PROTECTED_NODE');
  expect(() => planAIDataWorkflowAfterPatch({...original, nodes: {...original.nodes, implement: {...original.nodes.implement!, config: {}}}}, 'review')).toThrow('AI_DATA_AFTER_TARGET_NOT_REOPENABLE');
});
