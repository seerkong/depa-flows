import type {
  AIWorkflowKind,
  AIWorkflowSubstrate,
  AIWorkflowReusePolicy,
} from "./index.js";

export const AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY =
  "semantic-hash" as const;

export const AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY = "never" as const;

export interface AIWorkflowProfileDescriptor<
  Kind extends AIWorkflowKind = AIWorkflowKind,
  Substrate extends AIWorkflowSubstrate = AIWorkflowSubstrate,
> {
  readonly kind: Kind;
  readonly substrate: Substrate;
  readonly defaultReusePolicy: AIWorkflowReusePolicy;
  readonly manualNodeDefaultReusePolicy: "never";
}

export const AI_CTRL_WORKFLOW_DESCRIPTOR = Object.freeze({
  kind: "AICtrlWorkflow",
  substrate: "WorkCtrlFlow",
  defaultReusePolicy: AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY,
  manualNodeDefaultReusePolicy: AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY,
} satisfies AIWorkflowProfileDescriptor<"AICtrlWorkflow", "WorkCtrlFlow">);

export const AI_DATA_WORKFLOW_DESCRIPTOR = Object.freeze({
  kind: "AIDataWorkflow",
  substrate: "EagerDataFlow",
  defaultReusePolicy: AI_WORKFLOW_MACHINE_NODE_DEFAULT_REUSE_POLICY,
  manualNodeDefaultReusePolicy: AI_WORKFLOW_MANUAL_NODE_DEFAULT_REUSE_POLICY,
} satisfies AIWorkflowProfileDescriptor<"AIDataWorkflow", "EagerDataFlow">);
