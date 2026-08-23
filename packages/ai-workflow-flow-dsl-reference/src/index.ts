import { fileURLToPath } from 'node:url';
import type { AuthoringModuleDescriptor } from 'halfcode-compiler.xnl';

export const AI_WORKFLOW_FLOW_DSL_REFERENCE_MODULE = Object.freeze({
  id: 'DepaFlowsFlowDslReference',
  packageName: 'ai-workflow-flow-dsl-reference',
  family: 'depa-flow-dsl',
  scope: 'shared',
} as const);

export function loadAIWorkflowFlowDslReferenceModule(): AuthoringModuleDescriptor {
  return Object.freeze({
    ...AI_WORKFLOW_FLOW_DSL_REFERENCE_MODULE,
    resourceRootDir: fileURLToPath(new URL('./resource-module/', import.meta.url)),
  });
}
