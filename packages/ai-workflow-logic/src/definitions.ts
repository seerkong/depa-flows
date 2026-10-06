import type {
  AICtrlWorkflowDefinitionBinding,
  AIDataWorkflowDefinitionBinding,
} from "ai-workflow-contract";
import {
  AI_CTRL_WORKFLOW_DESCRIPTOR,
  AI_DATA_WORKFLOW_DESCRIPTOR,
} from "ai-workflow-contract/profiles";

export function defineAICtrlWorkflow(
  definition: AICtrlWorkflowDefinitionBinding["definition"],
): AICtrlWorkflowDefinitionBinding {
  return Object.freeze({
    kind: "AICtrlWorkflow",
    substrate: "WorkCtrlFlow",
    descriptor: AI_CTRL_WORKFLOW_DESCRIPTOR,
    definition,
  });
}

export function defineAIDataWorkflow(
  definition: AIDataWorkflowDefinitionBinding["definition"],
): AIDataWorkflowDefinitionBinding {
  return Object.freeze({
    kind: "AIDataWorkflow",
    substrate: "EagerDataFlow",
    descriptor: AI_DATA_WORKFLOW_DESCRIPTOR,
    definition,
  });
}
