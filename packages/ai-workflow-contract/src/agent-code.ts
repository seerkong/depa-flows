import type { CodeBinding, FrozenCodeClosure } from 'halfcode-compiler.xnl/application-assembly';
import type { ResourceRecord, Sha256Digest } from 'halfcode-compiler.xnl/resource-core';
import type { FlowClosedObject } from 'work-ctrl-flow-contract';
import type { AIWorkflowTypedResourceRef } from './index.js';

export type AIAgentCodeResourceKind = 'AgentContextPipeline' | 'AgentMessageSource';
/** Closed identity derived from the actual native resolver output. */
export interface AIAgentResolvedResourceIdentity {
  readonly resourceId: string;
  readonly readerId: string;
  readonly readerSpecVersion: number;
  readonly effectiveContentDigest: Sha256Digest;
  readonly readerProfileId: string;
  readonly resolutionReceiptDigest: Sha256Digest;
}
interface AIAgentCodeProjectionBase {
  readonly kind: AIAgentCodeResourceKind;
  readonly resource: ResourceRecord;
  readonly config: FlowClosedObject;
  readonly assets: Readonly<Record<string, 'text' | 'json'>>;
  readonly dependencies: readonly AIWorkflowTypedResourceRef[];
}
export type AIAgentCodeResourceProjection = AIAgentCodeProjectionBase & (
  | { readonly mode: 'native'; readonly binding: CodeBinding }
  | { readonly mode: 'legacy'; readonly content: string }
);
export interface FrozenAIAgentCodeArtifact {
  readonly resourceResolution?: AIAgentResolvedResourceIdentity;
  readonly schemaVersion: 'ai-workflow.agent-code-artifact/v1';
  readonly resourceId: string;
  readonly resourceDigest: Sha256Digest;
  readonly config: FlowClosedObject;
  readonly closure: FrozenCodeClosure;
}
export interface AIAgentCodeExecutionIdentity {
  readonly resourceId: string;
  readonly resourceDigest: Sha256Digest;
  readonly artifactDigest: Sha256Digest;
  readonly closureDigest: string;
}
/** Runtime handle. Persist artifact/identity, never the callable. */
export interface CompiledAIAgentCodeExecution {
  readonly artifact: FrozenAIAgentCodeArtifact;
  readonly artifactDigest: Sha256Digest;
  readonly execute: (runtime: unknown, input: unknown) => unknown;
}
