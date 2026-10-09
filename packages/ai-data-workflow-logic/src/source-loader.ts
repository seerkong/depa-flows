import type { AIDataWorkflowDefinitionBinding } from "ai-workflow-contract";
import { defineAIDataWorkflow } from "ai-workflow-logic/definitions";
import type {
  EagerDataFlowDiagnostic,
  EagerDataFlowSourceCollection,
  LoadEagerDataFlowOptions,
} from "eager-data-flow-contract";
import {
  loadEagerDataFlowProfileSources,
  loadEagerDataFlowProfileSourcesWithRuntime,
} from "eager-data-flow-logic/browser";
import {
  createDefinitionStepSourceRuntime,
  type DefinitionStepAssemblyRuntime,
} from "flow-step-space-logic/browser";

export function defineEagerBackedAIDataWorkflow(
  definition: AIDataWorkflowDefinitionBinding["definition"],
): AIDataWorkflowDefinitionBinding {
  return defineAIDataWorkflow(definition);
}

export interface AIDataWorkflowSourceLoadResult {
  readonly binding?: AIDataWorkflowDefinitionBinding;
  readonly diagnostics: readonly EagerDataFlowDiagnostic[];
}

export interface AIDataWorkflowSourceLoadRuntime {
  readonly extensionCodecs: DefinitionStepAssemblyRuntime["extensionCodecs"];
}

export interface AIDataWorkflowSourceLoadInput {
  readonly sources: EagerDataFlowSourceCollection;
}

export type AIDataWorkflowSourceLoadConfig = LoadEagerDataFlowOptions;

/** Processor form for profile admission with runtime-owned extension codecs. */
export function loadAIDataWorkflow(
  runtime: AIDataWorkflowSourceLoadRuntime,
  input: AIDataWorkflowSourceLoadInput,
  config: AIDataWorkflowSourceLoadConfig = {},
): AIDataWorkflowSourceLoadResult {
  const loaded = loadEagerDataFlowProfileSourcesWithRuntime(
    createDefinitionStepSourceRuntime(input.sources, runtime.extensionCodecs),
    input.sources,
    { ...config, profileRoot: "AIDataWorkflow" },
  );
  if (!loaded.plan || loaded.diagnostics.length > 0)
    return { diagnostics: loaded.diagnostics };
  return {
    binding: defineEagerBackedAIDataWorkflow(loaded.plan),
    diagnostics: loaded.diagnostics,
  };
}

export function loadAIDataWorkflowSources(
  sources: EagerDataFlowSourceCollection,
  options: LoadEagerDataFlowOptions = {},
): AIDataWorkflowSourceLoadResult {
  const loaded = loadEagerDataFlowProfileSources(sources, {
    ...options,
    profileRoot: "AIDataWorkflow",
  });
  if (!loaded.plan || loaded.diagnostics.length > 0) {
    return { diagnostics: loaded.diagnostics };
  }
  return {
    binding: defineEagerBackedAIDataWorkflow(loaded.plan),
    diagnostics: loaded.diagnostics,
  };
}
