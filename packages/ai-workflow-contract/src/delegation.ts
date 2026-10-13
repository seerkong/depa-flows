import type { FlowClosedValue } from './index.js';

/** One task delegated to an existing native owner, never a replacement Agent definition. */
export interface WorkflowTaskDelegation {
  readonly kind: 'workflow.task-delegation/v1';
  readonly task: {
    readonly nodeId: string;
    readonly agentDefinitionRef: `resource://${string}`;
    readonly input: FlowClosedValue;
  };
  readonly context:
    | { readonly mode: 'fresh'; readonly owner: string; readonly providerScope: string }
    | { readonly mode: 'reuse'; readonly owner: string; readonly providerScope: string; readonly targetId: string }
    | { readonly mode: 'from-node'; readonly nodeId: string };
  readonly sessionPolicy: 'shared' | 'independent-per-generation';
  readonly materials: readonly WorkflowFrozenMaterialReference[];
  /** Host-owned execution configuration. The engine freezes and passes this value without interpreting it. */
  readonly execution?: FlowClosedValue;
}

/** References are verified by the injected native material owner; engines perform no file IO. */
export interface WorkflowFrozenMaterialReference {
  readonly id: string;
  readonly role: 'instruction' | 'auxiliary';
  readonly ref: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface WorkflowDelegationLineage {
  readonly instanceId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly invocationKey: string;
  readonly visit: string;
  readonly generation: number;
  readonly sourceInvocationKey?: string;
}

export interface WorkflowDelegationOwnerTarget {
  readonly owner: string;
  readonly providerScope: string;
  readonly targetId: string;
}

export interface WorkflowDelegationRequest {
  readonly delegation: WorkflowTaskDelegation;
  readonly lineage: WorkflowDelegationLineage;
  readonly attempt: number;
  readonly target?: WorkflowDelegationOwnerTarget;
}

/** Every observation binds the original request and the owner's actual accepted context. */
export type WorkflowDelegationObservation = {
  readonly invocationKey: string;
  readonly attempt: number;
  readonly receiptId: string;
} & (
  | { readonly status: 'pending' | 'busy' | 'awaiting-user' | 'unknown'; readonly target?: WorkflowDelegationOwnerTarget }
  | { readonly status: 'completed'; readonly target: WorkflowDelegationOwnerTarget; readonly output: FlowClosedValue }
  | { readonly status: 'failed'; readonly target: WorkflowDelegationOwnerTarget; readonly settled: true; readonly reason: string }
  | { readonly status: 'rejected' | 'not-dispatched'; readonly settled: true; readonly reason: string }
);

/** submit is called by the CAS reservation winner only; all recovery uses observe. */
export interface WorkflowDelegationEffectPort {
  verifyMaterials(materials: readonly WorkflowFrozenMaterialReference[]): Promise<void>;
  submit(request: WorkflowDelegationRequest): Promise<WorkflowDelegationObservation>;
  observe(request: WorkflowDelegationRequest): Promise<WorkflowDelegationObservation>;
}

export interface WorkflowDelegationAttempt {
  readonly request: WorkflowDelegationRequest;
  readonly dispatchClaimed: boolean;
  readonly observation?: WorkflowDelegationObservation;
}

export interface WorkflowDelegationRecord {
  readonly attempts: readonly WorkflowDelegationAttempt[];
}
