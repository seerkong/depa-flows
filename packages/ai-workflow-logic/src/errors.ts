import type { AIWorkflowResourceProjectionDiagnostic } from 'ai-workflow-contract';

export class AIWorkflowFoundationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIWorkflowFoundationError';
  }
}

export class AIWorkflowResourceProjectionError extends AIWorkflowFoundationError {
  constructor(public readonly diagnostics: readonly AIWorkflowResourceProjectionDiagnostic[]) {
    super(`AI workflow resource projection failed with ${diagnostics.length} diagnostic(s)`);
    this.name = 'AIWorkflowResourceProjectionError';
  }
}

export class FlowRunCheckpointVersionConflictError extends Error {
  constructor(
    public readonly expectedVersion: number | null,
    public readonly actualVersion: number | null,
  ) {
    super(`Flow run checkpoint version conflict: expected ${String(expectedVersion)}, actual ${String(actualVersion)}`);
    this.name = 'FlowRunCheckpointVersionConflictError';
  }
}

export class FlowRunCheckpointTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowRunCheckpointTransitionError';
  }
}
