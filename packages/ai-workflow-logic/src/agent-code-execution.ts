import type { AIAgentCodeResourceProjection, CompiledAIAgentCodeExecution, FlowClosedObject, FrozenAIAgentCodeArtifact } from 'ai-workflow-contract';
import { captureCodeClosure, type CodeBinding, type CodeExecutionEnvironment } from 'halfcode-compiler.xnl/application-assembly';
import { bindCodeClosure, type CodeClosureExecutionRuntime } from 'halfcode-compiler.xnl/authoring-runtime';
import { digestCanonical, type ResourcePackageReadPort, type ResolvedResourceRecord, type Sha256Digest } from 'halfcode-compiler.xnl/resource-core';
import { markAIAgentCodeExecution } from './agent-code-brand.js';
import { isAuthenticAIAgentCodeProjection } from './agent-code-projection.js';
import { normalizeFlowClosedObject } from './run-checkpoint.js';
import { resolutionForAIAgentCodeProjection } from './agent-execution-resources.js';

export interface LegacyAIAgentCodeBinding {
  readonly binding: CodeBinding;
  readonly config: FlowClosedObject;
  readonly assets?: Readonly<Record<string, 'text' | 'json'>>;
}
export interface CompileAIAgentCodeRuntime extends CodeClosureExecutionRuntime {
  readonly source: ResourcePackageReadPort;
  readonly sourceRoot: string;
  readonly entryPath: string;
  readonly environment: CodeExecutionEnvironment;
  /** Explicit host compatibility adapter, never an implementation-name switch here. */
  readonly resolveLegacy?: (projection: Extract<AIAgentCodeResourceProjection, { mode: 'legacy' }>) => LegacyAIAgentCodeBinding;
}

export async function compileAgentContextPipeline(runtime: CompileAIAgentCodeRuntime, projection: AIAgentCodeResourceProjection): Promise<CompiledAIAgentCodeExecution> {
  if (projection.kind !== 'AgentContextPipeline') fail('Expected AgentContextPipeline');
  return compile(runtime, projection);
}
export async function compileAgentMessageSource(runtime: CompileAIAgentCodeRuntime, projection: AIAgentCodeResourceProjection): Promise<CompiledAIAgentCodeExecution> {
  if (projection.kind !== 'AgentMessageSource') fail('Expected AgentMessageSource');
  return compile(runtime, projection);
}
async function compile(runtime: CompileAIAgentCodeRuntime, projection: AIAgentCodeResourceProjection): Promise<CompiledAIAgentCodeExecution> {
  assertProjection(projection);
  const resourceResolution = resolutionForAIAgentCodeProjection(projection);
  const recipe = projection.mode === 'native' ? projection : runtime.resolveLegacy?.(projection);
  if (!recipe) fail('Legacy recipe requires an explicit builtin binding resolver');
  const config = normalizeFlowClosedObject(recipe.config);
  const closure = await captureCodeClosure({ source: runtime.source }, {
    binding: recipe.binding,
    sourceRoot: runtime.sourceRoot,
    entryPath: runtime.entryPath,
    assets: recipe.assets,
    environment: runtime.environment,
  });
  const artifact: FrozenAIAgentCodeArtifact = Object.freeze({
    schemaVersion: 'ai-workflow.agent-code-artifact/v1',
    resourceId: projection.resource.resourceId,
    resourceDigest: codeResourceDigest(projection),
    ...(resourceResolution ? { resourceResolution } : {}),
    config,
    closure,
  });
  return restoreAIAgentCodeExecution(runtime, projection, artifact, digestCanonical(artifact));
}

/** Rebuilds an execution handle against an authentic frozen registry projection. */
export function restoreAIAgentCodeExecution(
  runtime: CodeClosureExecutionRuntime,
  projection: AIAgentCodeResourceProjection,
  input: FrozenAIAgentCodeArtifact,
  expectedDigest: Sha256Digest,
): CompiledAIAgentCodeExecution {
  assertProjection(projection);
  const closed = normalizeFlowClosedObject(input, 'agent-code-artifact');
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest) || digestCanonical(closed) !== expectedDigest) fail('Artifact differs from trusted expected digest');
  if (Object.keys(closed).some(key => !['schemaVersion', 'resourceId', 'resourceDigest', 'resourceResolution', 'config', 'closure'].includes(key))) fail('Unsupported artifact field');
  if (closed.schemaVersion !== 'ai-workflow.agent-code-artifact/v1'
    || closed.resourceId !== projection.resource.resourceId
    || closed.resourceDigest !== codeResourceDigest(projection)) fail('Artifact does not belong to this exact resource recipe');
  if (digestCanonical(closed.resourceResolution ?? null) !== digestCanonical(resolutionForAIAgentCodeProjection(projection) ?? null)) fail('Artifact reader resolution differs from the exact execution observation');
  // Closed-data validation above detaches and freezes all arrays/maps before narrowing.
  const artifact = closed as unknown as FrozenAIAgentCodeArtifact;
  const config = normalizeFlowClosedObject(artifact.config);
  if (projection.mode === 'native'
    && (digestCanonical(artifact.closure.binding) !== digestCanonical(projection.binding)
      || digestCanonical(config) !== digestCanonical(projection.config))) fail('Artifact binding/config differs from native resource');
  const execute = bindCodeClosure(runtime, artifact.closure, artifact.closure.digest);
  const handle = Object.freeze({ artifact, artifactDigest: expectedDigest, execute: (runtimeInput: unknown, inputValue: unknown) => execute(runtimeInput, inputValue, config) });
  return markAIAgentCodeExecution(handle, {
    projection,
    identity: Object.freeze({ resourceId: artifact.resourceId, resourceDigest: artifact.resourceDigest, artifactDigest: expectedDigest, closureDigest: artifact.closure.digest }),
  });
}

function assertProjection(projection: AIAgentCodeResourceProjection): void {
  if (!isAuthenticAIAgentCodeProjection(projection)) fail('An authentic code resource projection is required');
}
function codeResourceDigest(projection: AIAgentCodeResourceProjection): Sha256Digest {
  const resource = projection.resource;
  const resolved = resource as Partial<ResolvedResourceRecord>;
  const resourceResolution = resolutionForAIAgentCodeProjection(projection);
  return digestCanonical({
    resourceId: resource.resourceId, kind: resource.kind, metadata: resource.metadata, node: resource.node,
    ...(resourceResolution ? { resourceResolution } : {}),
    ...(resolved.stage === 'resolved' ? { readerId: resolved.readerId, readerSpecVersion: resolved.readerSpecVersion, effectiveContentDigest: resolved.effectiveContentDigest } : {}),
  });
}
function fail(message: string): never { throw new Error(`AI_AGENT_CODE_EXECUTION_INVALID: ${message}`); }
