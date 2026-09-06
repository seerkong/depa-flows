import Ajv, { type ValidateFunction } from 'ajv';
import {
  DEPA_AI_RESOURCE_KIND_OWNERS,
  DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS,
  DEPA_AI_RESOURCE_KIND_SPEC_REVISIONS,
  DEPA_AI_RESOURCE_KIND_SPEC_RESOLUTIONS,
} from 'ai-workflow-contract';
import type {
  AuthoredResourceTree,
  JsonSchemaValidator,
  KindSpecRevision,
  PortableSpec,
  ResolvedResourceTree,
  ResourceContentIdentity,
} from 'halfcode-compiler.xnl/resource-core';
import { createResourceContentIdentity, digestCanonical } from 'halfcode-compiler.xnl/resource-core';
import {
  CORE_KIND_READER_REGISTRATIONS,
  CORE_KIND_SPEC_REVISIONS,
  CORE_KIND_SUBJECT_OWNERS,
  KindContractRegistry,
  KindReaderRegistry,
  SpecResolutionRegistry,
  createReaderProfile,
  resolveResourceTree,
  type ReaderProfile,
} from 'halfcode-compiler.xnl/kind-definition';

export const DEPA_AI_RESOURCE_READER_PROFILE_ID = 'depa.flows.ai-resources.v1' as const;

export interface AIWorkflowResourceResolutionContext {
  readonly contracts: KindContractRegistry;
  readonly readers: KindReaderRegistry;
  readonly readerProfile: ReaderProfile;
  readonly resolutions: SpecResolutionRegistry;
  readonly validator: JsonSchemaValidator;
}

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const compiledSchemas = new Map<string, ValidateFunction>();

export const AI_WORKFLOW_RESOURCE_SCHEMA_VALIDATOR: JsonSchemaValidator = Object.freeze({
  validate(revision: KindSpecRevision, value: PortableSpec): readonly string[] {
    let validate = compiledSchemas.get(revision.contractFingerprint);
    if (!validate) {
      validate = ajv.compile(revision.specSchema);
      compiledSchemas.set(revision.contractFingerprint, validate);
    }
    return validate(value)
      ? Object.freeze([])
      : Object.freeze((validate.errors ?? []).map((error) =>
          `${error.instancePath || '/'} ${error.message ?? 'invalid'}`));
  },
});

export function createAIWorkflowResourceResolutionContext(
  validator: JsonSchemaValidator = AI_WORKFLOW_RESOURCE_SCHEMA_VALIDATOR,
  tree?: AuthoredResourceTree,
): AIWorkflowResourceResolutionContext {
  const contracts = new KindContractRegistry();
  for (const owner of [...CORE_KIND_SUBJECT_OWNERS, ...DEPA_AI_RESOURCE_KIND_OWNERS]) {
    contracts.registerOwner(owner);
  }
  // A package's declared revision set is an exact Halfcode admission boundary.
  // Old packages keep their original v1 profile; new packages declare v1+v2.
  const revisions = [...CORE_KIND_SPEC_REVISIONS, ...DEPA_AI_RESOURCE_KIND_SPEC_REVISIONS].filter(revision => {
    const definition = tree && [...tree.registry.kindDefinitions.values()].find(item => item.subjectFqn === revision.subjectFqn);
    return definition
      ? definition.specRevisions.some(item => item.specVersion === revision.specVersion)
      : revision.specVersion === 1;
  });
  for (const revision of revisions) {
    contracts.registerRevision(revision);
  }
  const hasRevision = (subjectFqn: string, specVersion: number): boolean => revisions.some(revision =>
    revision.subjectFqn === subjectFqn && revision.specVersion === specVersion);

  const readerRegistrations = [
    ...CORE_KIND_READER_REGISTRATIONS,
    ...DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS,
  ].filter(reader => hasRevision(reader.subjectFqn, reader.readerSpecVersion));
  const readers = new KindReaderRegistry();
  for (const reader of readerRegistrations) readers.register(reader);
  const selectedReaders = readerRegistrations.filter(reader => !readerRegistrations.some(other =>
    other.subjectFqn === reader.subjectFqn && other.readerSpecVersion > reader.readerSpecVersion));
  const targets = selectedReaders.map((reader) => ({
    readerId: reader.readerId,
    subjectFqn: reader.subjectFqn,
    readerSpecVersion: reader.readerSpecVersion,
    contractFingerprint: reader.contractFingerprint,
    readerImplementationFingerprint: reader.readerImplementationFingerprint,
  }));
  const readerProfile = createReaderProfile(
    targets.some(target => target.readerSpecVersion !== 1)
      ? `${DEPA_AI_RESOURCE_READER_PROFILE_ID}/${digestCanonical(targets)}`
      : DEPA_AI_RESOURCE_READER_PROFILE_ID,
    targets,
  );
  const resolutions = new SpecResolutionRegistry(contracts);
  for (const resolution of DEPA_AI_RESOURCE_KIND_SPEC_RESOLUTIONS) {
    if (hasRevision(resolution.subjectFqn, resolution.writerSpecVersion)
      && hasRevision(resolution.subjectFqn, resolution.readerSpecVersion)) {
      resolutions.register(resolution);
    }
  }
  return Object.freeze({
    contracts,
    readers,
    readerProfile,
    resolutions,
    validator,
  });
}

export function resolveAIWorkflowResourceTree(
  tree: AuthoredResourceTree,
  context?: AIWorkflowResourceResolutionContext,
): ResolvedResourceTree {
  return resolveResourceTree({ tree, ...(context ?? createAIWorkflowResourceResolutionContext(undefined, tree)) });
}

/**
 * Projects Halfcode's exact resolved content identity into the public dependency
 * snapshot shape. The digest is still constructed by Halfcode; depa-flows only
 * chooses the resolved receipt identity as the authority input.
 */
export function createResolvedAIWorkflowContentIdentityIndex(
  tree: ResolvedResourceTree,
): ReadonlyMap<string, ResourceContentIdentity> {
  const entries: Array<readonly [string, ResourceContentIdentity]> = [];
  for (const records of tree.registry.byKind.values()) {
    for (const record of records) {
      entries.push([record.resourceId, createResourceContentIdentity({
        resourceId: record.resourceId,
        authorityDigest: record.effectiveContentDigest,
      })]);
    }
  }
  entries.sort(([left], [right]) => compareCodeUnits(left, right));
  return new Map(entries);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
