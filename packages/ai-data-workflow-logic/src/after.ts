import type {AIDataWorkflowAfterPolicy, AIDataWorkflowGraphPatch, AIDataWorkflowRunGraph} from 'ai-data-workflow-contract';
import {normalizeFlowClosedObject} from 'ai-workflow-logic';
import {canonicalOwnDataDigest} from 'task-manager-contract';
import type {EagerDataFlowValue} from 'eager-data-flow-contract';
import type {FlowClosedValue} from 'ai-workflow-contract';

function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
/** 旧 Eager 合同的数组可写；只作脱离输入引用的纯值转换，不放宽合同。 */
function eagerValue(value: FlowClosedValue): EagerDataFlowValue {
  if (Array.isArray(value)) return value.map(eagerValue);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, eagerValue(item)]));
  return value;
}
function policy(value: unknown): AIDataWorkflowAfterPolicy {
  const row = normalizeFlowClosedObject(value);
  const keys = ['schemaVersion', 'targetNodeId', 'resultPort', 'decisionField', 'reopenValue', 'completeValue', 'maxReopens'];
  requireThat(Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key)), 'AI_DATA_AFTER_POLICY_FIELDS');
  requireThat(row.schemaVersion === 'depa.ai-data-after/v1', 'AI_DATA_AFTER_POLICY_VERSION');
  for (const key of ['targetNodeId', 'resultPort', 'decisionField', 'reopenValue', 'completeValue']) requireThat(typeof row[key] === 'string' && row[key].length > 0 && row[key].length <= 512 && row[key].trim() === row[key], 'AI_DATA_AFTER_POLICY_IDENTITY');
  requireThat(typeof row.targetNodeId === 'string' && typeof row.resultPort === 'string' && typeof row.decisionField === 'string' && typeof row.reopenValue === 'string' && typeof row.completeValue === 'string', 'AI_DATA_AFTER_POLICY_IDENTITY');
  requireThat(row.reopenValue !== row.completeValue && typeof row.maxReopens === 'number' && Number.isSafeInteger(row.maxReopens) && row.maxReopens >= 0 && row.maxReopens <= 5, 'AI_DATA_AFTER_POLICY_BUDGET');
  return {schemaVersion: row.schemaVersion, targetNodeId: row.targetNodeId, resultPort: row.resultPort, decisionField: row.decisionField, reopenValue: row.reopenValue, completeValue: row.completeValue, maxReopens: row.maxReopens};
}

/** 纯规划；调用 owner 必须通过原 checkpoint CAS 应用返回的补丁。 */
export function planAIDataWorkflowAfterPatch(graph: AIDataWorkflowRunGraph, sourceNodeId: string): AIDataWorkflowGraphPatch | undefined {
  const source = graph.nodes[sourceNodeId];
  if (!source || source.config.workflowAfter === undefined || !['Succeeded', 'Reused'].includes(source.status)) return;
  const declared = policy(source.config.workflowAfter);
  requireThat(source.result?.generation === source.generation && source.result.status === source.status, 'AI_DATA_AFTER_SOURCE_GENERATION');
  const outputs = normalizeFlowClosedObject(source.result.output);
  requireThat(Object.hasOwn(outputs, declared.resultPort), 'AI_DATA_AFTER_RESULT_PORT');
  const report = normalizeFlowClosedObject(outputs[declared.resultPort]);
  const decision = report[declared.decisionField];
  if (decision === declared.completeValue) return;
  requireThat(decision === declared.reopenValue, 'AI_DATA_AFTER_DECISION_UNSETTLED');
  const target = graph.nodes[declared.targetNodeId];
  requireThat(target?.tag === 'TransformNode' && target.nodeType !== 'manual' && target.config.workflowReopenable === true, 'AI_DATA_AFTER_TARGET_NOT_REOPENABLE');
  const seen = new Set<string>();
  const visit = (nodeId: string): void => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    for (const parent of graph.nodes[nodeId]?.dependsOn ?? []) visit(parent);
  };
  visit(sourceNodeId);
  requireThat(declared.targetNodeId !== sourceNodeId && seen.has(declared.targetNodeId), 'AI_DATA_AFTER_TARGET_NOT_PREDECESSOR');
  const affected = new Set<string>();
  const downstream = (nodeId: string): void => {
    if (affected.has(nodeId)) return;
    affected.add(nodeId);
    for (const node of Object.values(graph.nodes)) if (node.dependsOn.includes(nodeId)) downstream(node.id);
  };
  downstream(declared.targetNodeId);
  for (const nodeId of affected) {
    const node = graph.nodes[nodeId]!;
    requireThat(node.config.humanReview !== true && node.config.workflowReopenProtected !== true, 'AI_DATA_AFTER_PROTECTED_NODE');
    requireThat(node.status !== 'Running' && node.result?.status !== 'Waiting', 'AI_DATA_AFTER_UNSETTLED_NODE');
  }
  const prefix = 'after-reopen:' + canonicalOwnDataDigest([sourceNodeId, declared]).slice('sha256:'.length) + ':';
  const previous = graph.patchHistory.filter(receipt => receipt.patchId.startsWith(prefix));
  requireThat(previous.length < declared.maxReopens, 'AI_DATA_AFTER_BUDGET_EXHAUSTED');
  const outputHash = canonicalOwnDataDigest(report);
  const patchId = prefix + source.generation + ':' + outputHash;
  requireThat(!graph.patchHistory.some(receipt => receipt.patchId === patchId), 'AI_DATA_AFTER_ALREADY_APPLIED');
  const nodeResults = Object.fromEntries(Object.values(graph.nodes).filter(node => node.result).map(node => [node.id, {
    nodeId: node.id, generation: node.generation, status: node.status,
    ...(node.result!.output === undefined ? {} : {output: node.result!.output}),
  }]));
  const afterFeedback = normalizeFlowClosedObject({sourceNode: sourceNodeId, sourceGeneration: source.generation, outputHash, output: report, nodeResults});
  return {
    patchId,
    generation: graph.currentGeneration + 1,
    reason: '原生 after 准入的有界整改：' + sourceNodeId,
    operations: [{op: 'update-node', nodeId: target.id, changes: {config: Object.fromEntries(Object.entries(normalizeFlowClosedObject({...target.config, afterFeedback})).map(([key, value]) => [key, eagerValue(value)]))}}],
  };
}
