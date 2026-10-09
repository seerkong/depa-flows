import type { AICtrlWorkflowDefinitionBinding } from "ai-workflow-contract";
import { defineAICtrlWorkflow } from "ai-workflow-logic/definitions";
import type {
  FlowDiagnostic,
  FlowSourceCollection,
  LoadFlowSourcesOptions,
} from "instant-ctrl-flow-contract";
import { loadCtrlFlowProfileFromSources } from "instant-ctrl-flow-logic/browser";

export function defineWorkCtrlFlowBackedAICtrlWorkflow(
  definition: AICtrlWorkflowDefinitionBinding["definition"],
): AICtrlWorkflowDefinitionBinding {
  return defineAICtrlWorkflow(definition);
}

export interface AICtrlWorkflowSourceLoadResult {
  readonly binding?: AICtrlWorkflowDefinitionBinding;
  readonly diagnostics: readonly FlowDiagnostic[];
}

export function loadAICtrlWorkflowSources(
  sources: FlowSourceCollection,
  options: LoadFlowSourcesOptions = {},
): AICtrlWorkflowSourceLoadResult {
  const loaded = loadCtrlFlowProfileFromSources(sources, {
    ...options,
    profileRoot: "AICtrlWorkflow",
    substrateForm: "WorkCtrlFlow",
  });
  if (!loaded.spec || loaded.diagnostics.length > 0) {
    return { diagnostics: loaded.diagnostics };
  }
  return {
    binding: defineWorkCtrlFlowBackedAICtrlWorkflow(loaded.spec),
    diagnostics: loaded.diagnostics,
  };
}
