import { createHash } from 'node:crypto';
import { parseXnl, wordToString, type DataElementNode, type XnlNode } from 'xnl-core';
import type {
  DefinitionStep,
  DefinitionStepAssemblyConfig,
  DefinitionStepAssemblyInput,
  DefinitionStepAssemblyRuntime,
  DefinitionStepClosureEntry,
  DefinitionStepCoreNode,
  DefinitionStepDiagnostic,
  DefinitionStepDigest,
  DefinitionStepExtension,
  DefinitionStepExtensionRegistration,
  DefinitionStepForest,
  DefinitionStepForestNode,
  DefinitionStepGroup,
  DefinitionStepProfileLoadOptions,
  DefinitionStepProfileAssemblyConfig,
  DefinitionStepProfileAssemblyInput,
  DefinitionStepSourceCollection,
  DefinitionStepSourceRef,
  DefinitionStepMutationConfig,
  DefinitionStepMutationInvocation,
  DefinitionStepMutationRuntime,
  DefinitionStepSelector,
  DefinitionStepValue,
  ImmutableStepRecord,
  StepMerkleDiff,
  StepMerkleNode,
  StepMerkleTree,
} from 'flow-step-space-contract';

export * from 'flow-step-space-contract';

type CompatibleSourceCollection = DefinitionStepSourceCollection
  | readonly { readonly name: string; readonly content: string }[];

export class DefinitionStepAssemblyError extends Error {
  constructor(public readonly diagnostic: DefinitionStepDiagnostic) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = 'DefinitionStepAssemblyError';
  }
}

type Element = DataElementNode;

const isElement = (value: unknown): value is Element =>
  !!value && typeof value === 'object' && (value as Element).kind === 'DataElement';

const bodyChildren = (element: Element): Element[] => (element.body ?? []).filter(isElement);

const sectionChildren = (element: Element): Element[] => {
  if (!element.extend) return [];
  const order = element.extend.order ?? Object.keys(element.extend.children);
  return order.map((key) => element.extend!.children[key]).filter(isElement);
};

const idOf = (element: Element): string => wordToString(element.id) ?? '';

function fail(code: string, message: string, sourceRef?: string, stepId?: string): never {
  throw new DefinitionStepAssemblyError({
    code,
    message,
    ...(sourceRef === undefined ? {} : { sourceRef }),
    ...(stepId === undefined ? {} : { stepId }),
  });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(bytes: Uint8Array | string): DefinitionStepDigest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalJson(value: DefinitionStepValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, DefinitionStepValue>>;
  return `{${Object.keys(record).sort(compareCodeUnits).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function createImmutableStepRecord(keyValue: unknown, value: unknown): ImmutableStepRecord {
  if (typeof keyValue !== 'string' || !keyValue || keyValue !== keyValue.trim()) {
    fail('step-record-key-invalid', 'immutable step record key must be an exact non-empty string');
  }
  const normalized = closedValue(value, `record.${keyValue}`);
  const fact = canonicalJson({
    schemaVersion: 'depa.immutable-step-record/v1',
    key: keyValue,
    value: normalized,
  });
  return Object.freeze({
    schemaVersion: 'depa.immutable-step-record/v1',
    key: keyValue,
    value: normalized,
    digest: digest(fact),
  });
}

/** Pure mechanics only: the checkpoint owner decides if/when this root is admitted. */
export function buildStepMerkleTree(recordsValue: readonly ImmutableStepRecord[]): StepMerkleTree {
  if (!Array.isArray(recordsValue)) fail('step-merkle-records-invalid', 'records must be a dense array');
  closedValue(recordsValue, 'merkle.records');
  const records = [...recordsValue].sort((left, right) => compareCodeUnits(left.key, right.key));
  const keyOrder = records.map((record) => record.key);
  if (new Set(keyOrder).size !== keyOrder.length) fail('step-merkle-key-duplicate', 'record keys must be unique');
  if (records.length === 0) fail('step-merkle-empty', 'Merkle tree requires at least one record');
  const nodes: Record<string, StepMerkleNode> = {};
  const leafByKey: Record<string, DefinitionStepDigest> = {};
  let level = records.map((record) => {
    const nodeDigest = digest(canonicalJson({ kind: 'leaf', key: record.key, recordDigest: record.digest }));
    const leaf = Object.freeze({ kind: 'leaf' as const, key: record.key, recordDigest: record.digest, digest: nodeDigest });
    nodes[nodeDigest] = leaf;
    leafByKey[record.key] = nodeDigest;
    return { digest: nodeDigest, firstKey: record.key, lastKey: record.key };
  });
  while (level.length > 1) {
    const next: { digest: DefinitionStepDigest; firstKey: string; lastKey: string }[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      const nodeDigest = digest(canonicalJson({
        kind: 'branch',
        firstKey: left.firstKey,
        lastKey: right.lastKey,
        leftDigest: left.digest,
        rightDigest: right.digest,
      }));
      const branch = Object.freeze({
        kind: 'branch' as const,
        firstKey: left.firstKey,
        lastKey: right.lastKey,
        leftDigest: left.digest,
        rightDigest: right.digest,
        digest: nodeDigest,
      });
      nodes[nodeDigest] = branch;
      next.push({ digest: nodeDigest, firstKey: left.firstKey, lastKey: right.lastKey });
    }
    level = next;
  }
  return Object.freeze({
    schemaVersion: 'depa.step-merkle-tree/v1',
    rootDigest: level[0].digest,
    keyOrder: Object.freeze(keyOrder),
    leafByKey: Object.freeze(leafByKey),
    nodes: Object.freeze(nodes),
  });
}

export function diffStepMerkleTrees(
  before: StepMerkleTree | undefined,
  after: StepMerkleTree,
): StepMerkleDiff {
  const beforeDigests = new Set(Object.keys(before?.nodes ?? {}) as DefinitionStepDigest[]);
  const afterDigests = new Set(Object.keys(after.nodes) as DefinitionStepDigest[]);
  return Object.freeze({
    addedNodeDigests: Object.freeze([...afterDigests].filter((value) => !beforeDigests.has(value)).sort(compareCodeUnits)),
    reusedNodeDigests: Object.freeze([...afterDigests].filter((value) => beforeDigests.has(value)).sort(compareCodeUnits)),
    unreachableNodeDigests: Object.freeze([...beforeDigests].filter((value) => !afterDigests.has(value)).sort(compareCodeUnits)),
  });
}

function exactOwnDataRecord(
  value: unknown,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('closed-data-record', `${label} must be a plain data record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('closed-data-record', `${label} must use a plain object prototype`);
  }
  const record = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(record);
  for (const key of ownKeys) {
    if (typeof key !== 'string') fail('closed-data-key', `${label} has a non-string own key`);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) fail('closed-data-accessor', `${label}.${String(key)} must be a data property`);
    if (!allowed.includes(key)) fail('closed-data-field', `${label}.${key} is not allowed`);
  }
  return record;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor && !('value' in descriptor)) fail('closed-data-accessor', `${key} must be a data property`);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function closedValue(value: unknown, label: string): DefinitionStepValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail('closed-data-sparse-array', `${label} must not contain sparse array slots`);
      }
    }
    return Object.freeze(value.map((entry, index) => closedValue(entry, `${label}[${index}]`)));
  }
  const record = exactOwnDataRecord(value, Object.keys(value as object), label);
  return Object.freeze(Object.fromEntries(
    Object.keys(record).sort(compareCodeUnits).map((key) => [key, closedValue(ownValue(record, key), `${label}.${key}`)]),
  ));
}

function exactAttrs(element: Element, allowed: readonly string[], sourceRef: string): Record<string, XnlNode> {
  const attrs = (element.attributes ?? {}) as Record<string, XnlNode>;
  for (const key of Object.keys(attrs)) {
    if (!allowed.includes(key)) fail('step-field-unsupported', `<${element.tag}>.${key} is not allowed`, sourceRef);
  }
  return attrs;
}

function requiredString(attrs: Record<string, XnlNode>, key: string, sourceRef: string): string {
  const value = attrs[key];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail('step-field-invalid', `${key} must be a non-empty exact string`, sourceRef);
  }
  return value;
}

/** Closed virtual ref: relative slash segments only, with no traversal or platform path syntax. */
export function normalizeDefinitionStepSourceRef(value: unknown): DefinitionStepSourceRef {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail('step-source-ref-invalid', 'source ref must be a non-empty exact string');
  }
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\0')) {
    fail('step-source-ref-invalid', `source ref ${value} is not resource-local`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    fail('step-source-ref-invalid', `source ref ${value} contains an invalid segment`);
  }
  return value;
}

function parseRoot(bytes: Uint8Array, sourceRef: string, expectedTag: string): { root: Element; content: string } {
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('step-source-decode-invalid', `${sourceRef} is not valid UTF-8: ${(error as Error).message}`, sourceRef);
  }
  let parsed: ReturnType<typeof parseXnl>;
  try {
    parsed = parseXnl(content);
  } catch (error) {
    fail('step-source-parse-invalid', `${sourceRef}: ${(error as Error).message}`, sourceRef);
  }
  if ((parsed.warnings ?? []).length > 0) {
    fail('step-source-parser-warning', `${sourceRef}: parser warnings are fatal`, sourceRef);
  }
  const roots = parsed.nodes.filter(isElement);
  if (roots.length !== 1 || roots[0].tag !== expectedTag) {
    fail('step-source-root-invalid', `${sourceRef} must contain exactly one <${expectedTag}> root`, sourceRef);
  }
  return { root: roots[0], content };
}

function nodeProjection(element: Element, sourceRef: string): DefinitionStepCoreNode {
  const metadata = closedValue(element.metadata ?? {}, `${sourceRef}:metadata`) as Record<string, DefinitionStepValue>;
  const attrs = closedValue(element.attributes ?? {}, `${sourceRef}:attrs`) as Record<string, DefinitionStepValue>;
  const sections = Object.freeze(Object.fromEntries(sectionChildren(element).map((section) => [
    section.tag,
    nodeProjection(section, sourceRef),
  ])));
  return Object.freeze({
    tag: element.tag,
    ...(idOf(element) ? { id: idOf(element) } : {}),
    metadata,
    attrs,
    children: Object.freeze(bodyChildren(element).map((child) => nodeProjection(child, sourceRef))),
    sections,
  });
}

type AssemblyState = {
  readonly runtime: DefinitionStepAssemblyRuntime;
  readonly closure: DefinitionStepClosureEntry[];
  readonly closureByRef: Map<string, DefinitionStepClosureEntry>;
  readonly steps: Record<string, DefinitionStep>;
  readonly stepOrder: string[];
  readonly groupIds: Set<string>;
  readonly activeRefs: string[];
};

function readRoot(state: AssemblyState, refValue: unknown, expectedTag: string): { root: Element; entry: DefinitionStepClosureEntry } {
  const ref = normalizeDefinitionStepSourceRef(refValue);
  let entry = state.closureByRef.get(ref);
  if (!entry) {
    let bytes: Uint8Array;
    try {
      bytes = state.runtime.sources.readSource(ref);
    } catch (error) {
      if (error instanceof DefinitionStepAssemblyError) throw error;
      fail('step-source-read-failed', `${ref}: ${(error as Error).message}`, ref);
    }
    if (!(bytes instanceof Uint8Array)) fail('step-source-read-invalid', `${ref} reader must return Uint8Array`, ref);
    const parsed = parseRoot(bytes, ref, expectedTag);
    entry = Object.freeze({ ref, digest: digest(bytes), content: parsed.content });
    state.closure.push(entry);
    state.closureByRef.set(ref, entry);
    return { root: parsed.root, entry };
  }
  return { root: parseRoot(new TextEncoder().encode(entry.content), ref, expectedTag).root, entry };
}

function withActiveRef<T>(state: AssemblyState, ref: string, operation: () => T): T {
  if (state.activeRefs.includes(ref)) {
    fail('step-reference-cycle', `reference cycle: ${[...state.activeRefs, ref].join(' -> ')}`, ref);
  }
  state.activeRefs.push(ref);
  try {
    return operation();
  } finally {
    state.activeRefs.pop();
  }
}

function readExtension(
  state: AssemblyState,
  refElement: Element,
  stepId: string,
): DefinitionStepExtension {
  if (idOf(refElement)) fail('step-extension-ref-id-unsupported', 'ExtensionRef must not declare an id', undefined, stepId);
  const attrs = exactAttrs(refElement, ['kind', 'src', 'schema'], state.activeRefs.at(-1) ?? '');
  const kind = requiredString(attrs, 'kind', state.activeRefs.at(-1) ?? '');
  const registration = resolveExtensionRegistration(state.runtime, kind);
  if (!registration) fail('step-extension-kind-undeclared', `extension kind ${kind} is not registered`, undefined, stepId);
  const ref = normalizeDefinitionStepSourceRef(requiredString(attrs, 'src', state.activeRefs.at(-1) ?? ''));
  const declaredSchema = attrs.schema;
  if (declaredSchema !== undefined && typeof declaredSchema !== 'string') {
    fail('step-extension-schema-invalid', `extension ${kind} schema must be a string`, ref, stepId);
  }
  if (registration.schemaRef !== declaredSchema) {
    fail('step-extension-schema-mismatch', `extension ${kind} schema does not match its registry`, ref, stepId);
  }
  return withActiveRef(state, ref, () => {
    const { root, entry } = readRoot(state, ref, 'StepExtension');
    if (bodyChildren(root).length > 0 || sectionChildren(root).length > 0) {
      fail('step-extension-shape-invalid', `${ref} extension must be attribute-only`, ref, stepId);
    }
    const rootAttrs = exactAttrs(root, ['kind', 'schema', 'value'], ref);
    if (requiredString(rootAttrs, 'kind', ref) !== kind) {
      fail('step-extension-kind-mismatch', `${ref} kind does not match ExtensionRef`, ref, stepId);
    }
    if (rootAttrs.schema !== declaredSchema) {
      fail('step-extension-schema-mismatch', `${ref} schema does not match ExtensionRef`, ref, stepId);
    }
    const extensionId = idOf(root);
    if (!extensionId) fail('step-extension-id-missing', `${ref} StepExtension requires an id`, ref, stepId);
    const rawValue = closedValue(rootAttrs.value ?? null, `${ref}:value`);
    let normalizedValue = rawValue;
    try {
      normalizedValue = closedValue(registration.codec.normalize(rawValue, {
        kind,
        ...(typeof declaredSchema === 'string' ? { schemaRef: declaredSchema } : {}),
        sourceRef: ref,
        stepId,
      }), `${ref}:codec`);
    } catch (error) {
      if (error instanceof DefinitionStepAssemblyError) throw error;
      fail('step-extension-codec-invalid', `${ref} codec rejected the extension: ${(error as Error).message}`, ref, stepId);
    }
    return Object.freeze({
      id: extensionId,
      kind,
      sourceRef: ref,
      ...(typeof declaredSchema === 'string' ? { schemaRef: declaredSchema } : {}),
      value: normalizedValue,
      digest: entry.digest,
    });
  });
}

function readStep(state: AssemblyState, refElement: Element): DefinitionStepForestNode {
  const declaredId = idOf(refElement);
  if (!declaredId) fail('step-ref-id-missing', 'StepRef requires an id');
  const attrs = exactAttrs(refElement, ['src'], state.activeRefs.at(-1) ?? '');
  const ref = normalizeDefinitionStepSourceRef(requiredString(attrs, 'src', state.activeRefs.at(-1) ?? ''));
  return withActiveRef(state, ref, () => {
    const { root, entry } = readRoot(state, ref, 'Step');
    const stepId = idOf(root);
    if (stepId !== declaredId) fail('step-id-mismatch', `${ref} id ${stepId || '<missing>'} does not match StepRef ${declaredId}`, ref, declaredId);
    if (state.steps[stepId]) fail('step-id-duplicate', `step id ${stepId} is duplicated`, ref, stepId);
    exactAttrs(root, [], ref);
    if (bodyChildren(root).length > 0) fail('step-shape-invalid', `${ref} Step body must be empty`, ref, stepId);
    const sections = sectionChildren(root);
    const coreSections = sections.filter((section) => section.tag === 'Core');
    const extensionSections = sections.filter((section) => section.tag === 'Extensions');
    if (sections.some((section) => section.tag !== 'Core' && section.tag !== 'Extensions')
      || coreSections.length !== 1 || extensionSections.length > 1) {
      fail('step-shape-invalid', `${ref} requires one Core and at most one Extensions section`, ref, stepId);
    }
    const coreChildren = bodyChildren(coreSections[0]);
    if (coreChildren.length !== 1 || sectionChildren(coreSections[0]).length > 0) {
      fail('step-core-invalid', `${ref} Core requires exactly one executable child`, ref, stepId);
    }
    if (idOf(coreChildren[0]) !== stepId) {
      fail('step-core-id-mismatch', `${ref} Core id must equal Step id ${stepId}`, ref, stepId);
    }
    const extensions: Record<string, DefinitionStepExtension> = {};
    for (const extensionRef of extensionSections.flatMap(bodyChildren)) {
      if (extensionRef.tag !== 'ExtensionRef') fail('step-extension-ref-invalid', `${ref} Extensions accepts only ExtensionRef`, ref, stepId);
      const extension = readExtension(state, extensionRef, stepId);
      if (extensions[extension.kind]) fail('step-extension-kind-duplicate', `${stepId} extension ${extension.kind} is duplicated`, ref, stepId);
      extensions[extension.kind] = extension;
    }
    const step = Object.freeze({
      id: stepId,
      sourceRef: ref,
      core: nodeProjection(coreChildren[0], ref),
      extensions: Object.freeze(extensions),
      digest: entry.digest,
    });
    state.steps[stepId] = step;
    state.stepOrder.push(stepId);
    return Object.freeze({ kind: 'step' as const, stepId });
  });
}

function readGroupChildren(state: AssemblyState, group: Element, sourceRef?: string): DefinitionStepGroup {
  const id = idOf(group);
  if (!id) fail('step-group-id-missing', 'StepGroup requires an id', sourceRef);
  if (state.groupIds.has(id)) fail('step-group-id-duplicate', `group id ${id} is duplicated`, sourceRef);
  state.groupIds.add(id);
  exactAttrs(group, [], sourceRef ?? state.activeRefs.at(-1) ?? '');
  if (sectionChildren(group).length > 0) fail('step-group-shape-invalid', `StepGroup ${id} cannot have sections`, sourceRef);
  const children = bodyChildren(group).map((child) => readForestNode(state, child));
  if (children.length === 0) fail('step-group-empty', `StepGroup ${id} must not be empty`, sourceRef);
  return Object.freeze({ kind: 'group', id, ...(sourceRef ? { sourceRef } : {}), children: Object.freeze(children) });
}

function readGroupRef(state: AssemblyState, refElement: Element): DefinitionStepGroup {
  const declaredId = idOf(refElement);
  if (!declaredId) fail('step-group-ref-id-missing', 'StepGroupRef requires an id');
  const attrs = exactAttrs(refElement, ['src'], state.activeRefs.at(-1) ?? '');
  const ref = normalizeDefinitionStepSourceRef(requiredString(attrs, 'src', state.activeRefs.at(-1) ?? ''));
  return withActiveRef(state, ref, () => {
    const { root } = readRoot(state, ref, 'StepGroup');
    if (idOf(root) !== declaredId) fail('step-group-id-mismatch', `${ref} id must match StepGroupRef ${declaredId}`, ref);
    return readGroupChildren(state, root, ref);
  });
}

function readForestNode(state: AssemblyState, element: Element): DefinitionStepForestNode {
  if (element.tag === 'StepRef') return readStep(state, element);
  if (element.tag === 'StepGroup') return readGroupChildren(state, element);
  if (element.tag === 'StepGroupRef') return readGroupRef(state, element);
  fail('step-space-child-invalid', `StepSpace/StepGroup cannot contain <${element.tag}>`, state.activeRefs.at(-1));
}

function normalizeAssemblyBoundary(
  runtimeValue: DefinitionStepAssemblyRuntime,
  inputValue: DefinitionStepAssemblyInput,
  configValue: DefinitionStepAssemblyConfig,
) {
  const runtime = exactOwnDataRecord(runtimeValue, ['sources', 'extensionCodecs'], 'runtime');
  const sources = exactOwnDataRecord(ownValue(runtime, 'sources'), ['readSource'], 'runtime.sources');
  if (typeof ownValue(sources, 'readSource') !== 'function') fail('step-runtime-invalid', 'runtime.sources.readSource must be a function');
  const extensionCodecs = exactOwnDataRecord(ownValue(runtime, 'extensionCodecs'), ['resolve'], 'runtime.extensionCodecs');
  if (typeof ownValue(extensionCodecs, 'resolve') !== 'function') {
    fail('step-runtime-invalid', 'runtime.extensionCodecs.resolve must be a function');
  }
  const input = exactOwnDataRecord(inputValue, ['stepSpaceRef'], 'input');
  exactOwnDataRecord(configValue, [], 'config');
  return {
    runtime: runtimeValue,
    input: { stepSpaceRef: normalizeDefinitionStepSourceRef(ownValue(input, 'stepSpaceRef')) },
  };
}

function resolveExtensionRegistration(
  runtime: Pick<DefinitionStepAssemblyRuntime, 'extensionCodecs'> | Pick<DefinitionStepMutationRuntime, 'extensionCodecs'>,
  kind: string,
): DefinitionStepExtensionRegistration | undefined {
  if (!kind || kind !== kind.trim()) fail('step-extension-registration-invalid', 'extension kind must be an exact non-empty string');
  const registrationValue = runtime.extensionCodecs.resolve(kind);
  if (registrationValue === undefined) return undefined;
  const registration = exactOwnDataRecord(registrationValue, ['schemaRef', 'codec'], `runtime.extensionCodecs.${kind}`);
  const schemaRef = ownValue(registration, 'schemaRef');
  if (schemaRef !== undefined && (typeof schemaRef !== 'string' || !schemaRef)) {
    fail('step-extension-registration-invalid', `${kind}.schemaRef must be a non-empty string`);
  }
  const codec = ownValue(registration, 'codec');
  if (codec === undefined) fail('step-extension-registration-invalid', `${kind}.codec is required`);
  const codecRecord = exactOwnDataRecord(codec, ['normalize'], `runtime.extensionCodecs.${kind}.codec`);
  if (typeof ownValue(codecRecord, 'normalize') !== 'function') {
    fail('step-extension-registration-invalid', `${kind}.codec.normalize must be a function`);
  }
  return registrationValue as DefinitionStepExtensionRegistration;
}

function normalizeRegisteredExtensionValue(
  registration: DefinitionStepExtensionRegistration,
  value: unknown,
  context: { readonly kind: string; readonly sourceRef: string; readonly stepId: string },
): DefinitionStepValue {
  const closed = closedValue(value, `mutation.${context.stepId}.${context.kind}`);
  try {
    return closedValue(registration.codec.normalize(closed, {
      ...context,
      ...(registration.schemaRef ? { schemaRef: registration.schemaRef } : {}),
    }), `mutation.${context.stepId}.${context.kind}.codec`);
  } catch (error) {
    if (error instanceof DefinitionStepAssemblyError) throw error;
    fail('step-extension-codec-invalid', `${context.kind} codec rejected the mutation: ${(error as Error).message}`, context.sourceRef, context.stepId);
  }
}

/** Targeted Processor form: output = fn(runtime, selector, invocation, config). */
export function mutateDefinitionStep(
  runtime: DefinitionStepMutationRuntime,
  selector: DefinitionStepSelector,
  invocation: DefinitionStepMutationInvocation,
  config: DefinitionStepMutationConfig,
): DefinitionStep {
  if (!runtime || typeof runtime !== 'object'
    || !runtime.steps || typeof runtime.steps.readStep !== 'function'
    || typeof runtime.steps.writeStep !== 'function'
    || !runtime.extensionCodecs || typeof runtime.extensionCodecs.resolve !== 'function') {
    fail('step-mutation-runtime-invalid', 'runtime must provide steps and extensionCodecs ports');
  }
  exactOwnDataRecord(config, [], 'config');
  if (!selector || typeof selector !== 'object' || typeof selector.stepId !== 'string'
    || !selector.stepId || selector.stepId !== selector.stepId.trim()) {
    fail('step-mutation-selector-invalid', 'selector.stepId must be an exact non-empty string');
  }
  const before = runtime.steps.readStep(selector.stepId);
  if (!before) fail('step-mutation-target-missing', `step ${selector.stepId} does not exist`, undefined, selector.stepId);
  if (invocation.expectedDigest !== before.digest) {
    fail('step-mutation-version-conflict', `step ${selector.stepId} digest changed`, before.sourceRef, selector.stepId);
  }
  const extensions: Record<string, DefinitionStepExtension> = { ...before.extensions };
  for (const [kind, value] of Object.entries(invocation.extensions ?? {})) {
    const registration = resolveExtensionRegistration(runtime, kind);
    const prior = before.extensions[kind];
    if (!registration || !prior) {
      fail('step-extension-kind-undeclared', `extension kind ${kind} is not admitted for step ${selector.stepId}`, before.sourceRef, selector.stepId);
    }
    if (!registration.codec || typeof registration.codec.normalize !== 'function') {
      fail('step-extension-registration-invalid', `${kind}.codec.normalize is required for mutation`, before.sourceRef, selector.stepId);
    }
    if (registration.schemaRef !== prior.schemaRef) {
      fail('step-extension-schema-mismatch', `${kind} mutation registry does not match the admitted schema`, before.sourceRef, selector.stepId);
    }
    const normalized = normalizeRegisteredExtensionValue(registration, value, {
      kind,
      sourceRef: prior.sourceRef,
      stepId: selector.stepId,
    });
    extensions[kind] = Object.freeze({
      ...prior,
      value: normalized,
      digest: digest(canonicalJson({ kind, schemaRef: prior.schemaRef ?? null, value: normalized })),
    });
  }
  const core = invocation.core === undefined
    ? before.core
    : normalizeCore(invocation.core, `mutation.${selector.stepId}.core`);
  const next = Object.freeze({
    ...before,
    core,
    extensions: Object.freeze(extensions),
    digest: digest(JSON.stringify({ id: before.id, core, extensions })),
  });
  runtime.steps.writeStep(next, before.digest);
  return next;
}

/** Processor form: output = fn(runtime, input, config). */
export function assembleDefinitionStepForest(
  runtimeValue: DefinitionStepAssemblyRuntime,
  inputValue: DefinitionStepAssemblyInput,
  configValue: DefinitionStepAssemblyConfig,
): DefinitionStepForest {
  const { runtime, input } = normalizeAssemblyBoundary(runtimeValue, inputValue, configValue);
  const state: AssemblyState = {
    runtime,
    closure: [],
    closureByRef: new Map(),
    steps: {},
    stepOrder: [],
    groupIds: new Set(),
    activeRefs: [],
  };
  const rootRef = input.stepSpaceRef;
  state.activeRefs.push(rootRef);
  const root = readRoot(state, rootRef, 'StepSpace').root;
  exactAttrs(root, [], rootRef);
  if (sectionChildren(root).length > 0) fail('step-space-shape-invalid', 'StepSpace cannot have sections', rootRef);
  const id = idOf(root);
  if (!id) fail('step-space-id-missing', 'StepSpace requires an id', rootRef);
  const metadata = root.metadata ?? {};
  const apiVersion = typeof metadata.apiVersion === 'string' ? metadata.apiVersion : 'depa.flows/v1';
  const version = typeof metadata.version === 'string' ? metadata.version : '1';
  for (const key of Object.keys(metadata)) {
    if (key !== 'apiVersion' && key !== 'version') fail('step-space-metadata-unsupported', `StepSpace.${key} is not allowed`, rootRef);
  }
  let roots: DefinitionStepForestNode[];
  try {
    roots = bodyChildren(root).map((child) => readForestNode(state, child));
  } finally {
    state.activeRefs.pop();
  }
  if (roots.length === 0) fail('step-space-empty', 'StepSpace must not be empty', rootRef);
  const artifactFact = state.closure.map(({ ref, digest: value }) => [ref, value]);
  return normalizeDefinitionStepForest({
    schemaVersion: 'depa.definition-step-forest/v1',
    id,
    apiVersion,
    version,
    rootRef,
    roots,
    steps: state.steps,
    stepOrder: state.stepOrder,
    closure: state.closure,
    artifactDigest: digest(JSON.stringify(artifactFact)),
  });
}

function normalizeCore(value: unknown, label: string): DefinitionStepCoreNode {
  const record = exactOwnDataRecord(value, ['tag', 'id', 'metadata', 'attrs', 'children', 'sections'], label);
  const tag = ownValue(record, 'tag');
  const id = ownValue(record, 'id');
  if (typeof tag !== 'string' || !tag) fail('step-forest-invalid', `${label}.tag must be a string`);
  if (id !== undefined && (typeof id !== 'string' || !id)) fail('step-forest-invalid', `${label}.id must be a string`);
  const childrenValue = ownValue(record, 'children');
  if (!Array.isArray(childrenValue)) fail('step-forest-invalid', `${label}.children must be an array`);
  const children = closedValue(childrenValue, `${label}.children`) as readonly unknown[];
  const sectionsValue = exactOwnDataRecord(ownValue(record, 'sections'), Object.keys(ownValue(record, 'sections') as object), `${label}.sections`);
  return Object.freeze({
    tag,
    ...(typeof id === 'string' ? { id } : {}),
    metadata: closedValue(ownValue(record, 'metadata'), `${label}.metadata`) as Record<string, DefinitionStepValue>,
    attrs: closedValue(ownValue(record, 'attrs'), `${label}.attrs`) as Record<string, DefinitionStepValue>,
    children: Object.freeze(children.map((child, index) => normalizeCore(child, `${label}.children[${index}]`))),
    sections: Object.freeze(Object.fromEntries(Object.keys(sectionsValue).sort(compareCodeUnits).map((key) => [
      key,
      normalizeCore(ownValue(sectionsValue, key), `${label}.sections.${key}`),
    ]))),
  });
}

function normalizeForestNode(value: unknown, label: string): DefinitionStepForestNode {
  const kindRecord = exactOwnDataRecord(value, ['kind', 'stepId', 'id', 'sourceRef', 'children'], label);
  const kind = ownValue(kindRecord, 'kind');
  if (kind === 'step') {
    const stepId = ownValue(kindRecord, 'stepId');
    if (typeof stepId !== 'string' || !stepId) fail('step-forest-invalid', `${label}.stepId must be a string`);
    if (ownValue(kindRecord, 'id') !== undefined || ownValue(kindRecord, 'children') !== undefined || ownValue(kindRecord, 'sourceRef') !== undefined) {
      fail('step-forest-invalid', `${label} step leaf has group fields`);
    }
    return Object.freeze({ kind, stepId });
  }
  if (kind !== 'group') fail('step-forest-invalid', `${label}.kind is invalid`);
  const id = ownValue(kindRecord, 'id');
  const sourceRef = ownValue(kindRecord, 'sourceRef');
  const children = ownValue(kindRecord, 'children');
  if (typeof id !== 'string' || !id || !Array.isArray(children)) fail('step-forest-invalid', `${label} group is invalid`);
  if (sourceRef !== undefined) normalizeDefinitionStepSourceRef(sourceRef);
  return Object.freeze({
    kind,
    id,
    ...(typeof sourceRef === 'string' ? { sourceRef } : {}),
    children: Object.freeze(children.map((child, index) => normalizeForestNode(child, `${label}.children[${index}]`))),
  });
}

/** Pure closed-data normalizer; appropriate for decoded facts and tests. */
export function normalizeDefinitionStepForest(value: unknown): DefinitionStepForest {
  const record = exactOwnDataRecord(value, [
    'schemaVersion', 'id', 'apiVersion', 'version', 'rootRef', 'roots', 'steps', 'stepOrder', 'closure', 'artifactDigest',
  ], 'forest');
  if (ownValue(record, 'schemaVersion') !== 'depa.definition-step-forest/v1') fail('step-forest-invalid', 'forest schemaVersion is invalid');
  const stringField = (key: string) => {
    const result = ownValue(record, key);
    if (typeof result !== 'string' || !result) fail('step-forest-invalid', `forest.${key} must be a string`);
    return result;
  };
  const rootRef = normalizeDefinitionStepSourceRef(stringField('rootRef'));
  const rootsValue = ownValue(record, 'roots');
  const orderValue = ownValue(record, 'stepOrder');
  const closureValue = ownValue(record, 'closure');
  if (!Array.isArray(rootsValue) || !Array.isArray(orderValue) || !Array.isArray(closureValue)) {
    fail('step-forest-invalid', 'forest roots, stepOrder and closure must be arrays');
  }
  closedValue(orderValue, 'forest.stepOrder');
  const stepOrder = orderValue.map((item) => {
    if (typeof item !== 'string' || !item) fail('step-forest-invalid', 'forest.stepOrder entries must be strings');
    return item;
  });
  const stepsValue = exactOwnDataRecord(ownValue(record, 'steps'), Object.keys(ownValue(record, 'steps') as object), 'forest.steps');
  const steps: Record<string, DefinitionStep> = {};
  for (const key of Object.keys(stepsValue).sort(compareCodeUnits)) {
    const stepRecord = exactOwnDataRecord(ownValue(stepsValue, key), ['id', 'sourceRef', 'core', 'extensions', 'digest'], `forest.steps.${key}`);
    if (ownValue(stepRecord, 'id') !== key) fail('step-forest-invalid', `forest.steps.${key}.id mismatch`);
    const extensionsValue = exactOwnDataRecord(ownValue(stepRecord, 'extensions'), Object.keys(ownValue(stepRecord, 'extensions') as object), `forest.steps.${key}.extensions`);
    const extensions: Record<string, DefinitionStepExtension> = {};
    for (const kind of Object.keys(extensionsValue).sort(compareCodeUnits)) {
      const extensionRecord = exactOwnDataRecord(ownValue(extensionsValue, kind), ['id', 'kind', 'sourceRef', 'schemaRef', 'value', 'digest'], `forest.steps.${key}.extensions.${kind}`);
      const extensionKind = ownValue(extensionRecord, 'kind');
      const extensionId = ownValue(extensionRecord, 'id');
      const extensionSourceRef = ownValue(extensionRecord, 'sourceRef');
      const schemaRef = ownValue(extensionRecord, 'schemaRef');
      const extensionDigest = ownValue(extensionRecord, 'digest');
      if (extensionKind !== kind || typeof extensionId !== 'string' || typeof extensionDigest !== 'string') fail('step-forest-invalid', `extension ${kind} is invalid`);
      extensions[kind] = Object.freeze({
        id: extensionId,
        kind,
        sourceRef: normalizeDefinitionStepSourceRef(extensionSourceRef),
        ...(typeof schemaRef === 'string' ? { schemaRef } : {}),
        value: closedValue(ownValue(extensionRecord, 'value'), `forest.steps.${key}.extensions.${kind}.value`),
        digest: extensionDigest as DefinitionStepDigest,
      });
    }
    const stepSourceRef = normalizeDefinitionStepSourceRef(ownValue(stepRecord, 'sourceRef'));
    const stepDigest = ownValue(stepRecord, 'digest');
    if (typeof stepDigest !== 'string') fail('step-forest-invalid', `forest.steps.${key}.digest is invalid`);
    steps[key] = Object.freeze({
      id: key,
      sourceRef: stepSourceRef,
      core: normalizeCore(ownValue(stepRecord, 'core'), `forest.steps.${key}.core`),
      extensions: Object.freeze(extensions),
      digest: stepDigest as DefinitionStepDigest,
    });
  }
  if (new Set(stepOrder).size !== stepOrder.length || stepOrder.some((id) => !steps[id]) || Object.keys(steps).length !== stepOrder.length) {
    fail('step-forest-invalid', 'forest stepOrder must exactly identify steps');
  }
  const closure = closureValue.map((entry, index): DefinitionStepClosureEntry => {
    const closureRecord = exactOwnDataRecord(entry, ['ref', 'digest', 'content'], `forest.closure[${index}]`);
    const closureDigest = ownValue(closureRecord, 'digest');
    const content = ownValue(closureRecord, 'content');
    if (typeof closureDigest !== 'string' || typeof content !== 'string') fail('step-forest-invalid', `forest.closure[${index}] is invalid`);
    return Object.freeze({
      ref: normalizeDefinitionStepSourceRef(ownValue(closureRecord, 'ref')),
      digest: closureDigest as DefinitionStepDigest,
      content,
    });
  });
  return Object.freeze({
    schemaVersion: 'depa.definition-step-forest/v1',
    id: stringField('id'),
    apiVersion: stringField('apiVersion'),
    version: stringField('version'),
    rootRef,
    roots: Object.freeze(rootsValue.map((node, index) => normalizeForestNode(node, `forest.roots[${index}]`))),
    steps: Object.freeze(steps),
    stepOrder: Object.freeze(stepOrder),
    closure: Object.freeze(closure),
    artifactDigest: stringField('artifactDigest') as DefinitionStepDigest,
  });
}

export function createDefinitionStepSourceRuntime(
  sources: CompatibleSourceCollection,
  extensionCodecs: DefinitionStepAssemblyRuntime['extensionCodecs'] = Object.freeze({ resolve: () => undefined }),
): DefinitionStepAssemblyRuntime {
  const entries = Array.isArray(sources)
    ? sources.map((source) => ['ref' in source ? source.ref : source.name, source.content] as const)
    : Object.entries(sources);
  const byRef = new Map<string, Uint8Array>();
  for (const [refValue, content] of entries) {
    const ref = normalizeDefinitionStepSourceRef(refValue);
    if (byRef.has(ref)) fail('step-source-ref-duplicate', `source ${ref} is duplicated`, ref);
    if (typeof content !== 'string') fail('step-source-content-invalid', `source ${ref} content must be a string`, ref);
    byRef.set(ref, new TextEncoder().encode(content));
  }
  return Object.freeze({
    sources: Object.freeze({
      readSource(refValue: string): Uint8Array {
        const ref = normalizeDefinitionStepSourceRef(refValue);
        const bytes = byRef.get(ref);
        if (!bytes) fail('step-source-not-found', `source ${ref} is not declared`, ref);
        return bytes.slice();
      },
    }),
    extensionCodecs,
  });
}

function serializeValue(value: unknown): string {
  const normalized = closedValue(value, 'xnl.value');
  if (normalized === null || typeof normalized !== 'object') return JSON.stringify(normalized);
  if (Array.isArray(normalized)) return `[${normalized.map(serializeValue).join(' ')}]`;
  return `{ ${Object.entries(normalized).map(([key, item]) => `${key} = ${serializeValue(item)}`).join(' ')} }`;
}

function serializeElement(element: Element): string {
  const id = idOf(element);
  const metadata = Object.entries(element.metadata ?? {}).map(([key, value]) => `${key}=${serializeValue(value)}`).join(' ');
  const attrs = Object.entries(element.attributes ?? {}).map(([key, value]) => `${key}=${serializeValue(value)}`).join(' ');
  const sections = sectionChildren(element).map(serializeElement).join(' ');
  const body = bodyChildren(element).map(serializeElement).join(' ');
  return `<${element.tag}${id ? ` #${id}` : ''}${metadata ? ` ${metadata}` : ''}${attrs ? ` { ${attrs} }` : ''}${sections ? ` ( ${sections} )` : ''}${body ? ` [ ${body} ]` : ''}>`;
}

function coreToXnl(core: DefinitionStepCoreNode): string {
  const metadata = Object.entries(core.metadata).map(([key, value]) => `${key}=${serializeValue(value)}`).join(' ');
  const attrs = Object.entries(core.attrs).map(([key, value]) => `${key}=${serializeValue(value)}`).join(' ');
  const sections = Object.values(core.sections).map(coreToXnl).join(' ');
  const children = core.children.map(coreToXnl).join(' ');
  return `<${core.tag}${core.id ? ` #${core.id}` : ''}${metadata ? ` ${metadata}` : ''}${attrs ? ` { ${attrs} }` : ''}${sections ? ` ( ${sections} )` : ''}${children ? ` [ ${children} ]` : ''}>`;
}

export interface DefinitionStepProfileAssemblyResult {
  readonly sources: CompatibleSourceCollection;
  readonly forest?: DefinitionStepForest;
  readonly diagnostics: readonly DefinitionStepDiagnostic[];
}

/** Processor authority for profile composition: output = fn(runtime, input, config). */
export function assembleDefinitionStepProfile(
  runtime: DefinitionStepAssemblyRuntime,
  input: DefinitionStepProfileAssemblyInput,
  config: DefinitionStepProfileAssemblyConfig,
): DefinitionStepProfileAssemblyResult {
  return assembleDefinitionStepProfileSourcesWithRuntime(
    runtime,
    input.sources,
    config.profileRoot,
    config,
  );
}

/**
 * Pure-source composition helper used by profile owners. It only recognizes the
 * exact profileSourceRef and follows the explicit StepSpace closure.
 */
export function assembleDefinitionStepProfileSources(
  sources: CompatibleSourceCollection,
  profileRoot: string,
  options: DefinitionStepProfileLoadOptions = {},
): DefinitionStepProfileAssemblyResult {
  const normalizedSources: DefinitionStepSourceCollection = Array.isArray(sources)
    ? sources.map((source) => ({ ref: 'ref' in source ? source.ref : source.name, content: source.content }))
    : Object.entries(sources).map(([ref, content]) => ({ ref, content }));
  return assembleDefinitionStepProfile(
    createDefinitionStepSourceRuntime(sources),
    { sources: normalizedSources },
    { ...options, profileRoot },
  );
}

/** Runtime-first profile assembly for filesystem/VFS adapters with exact reads. */
export function assembleDefinitionStepProfileSourcesWithRuntime(
  runtime: DefinitionStepAssemblyRuntime,
  sources: CompatibleSourceCollection,
  profileRoot: string,
  options: DefinitionStepProfileLoadOptions = {},
): DefinitionStepProfileAssemblyResult {
  const entries = Array.isArray(sources)
    ? sources.map((source) => ({ ref: 'ref' in source ? source.ref : source.name, content: source.content }))
    : Object.entries(sources).map(([ref, content]) => ({ ref, content }));
  const profileSourceRef = options.profileSourceRef ?? 'manifest.xnl';
  const entry = entries.find((source) => source.ref === profileSourceRef);
  if (!entry) return { sources, diagnostics: [] };
  let root: Element;
  try {
    root = parseRoot(new TextEncoder().encode(entry.content), profileSourceRef, profileRoot).root;
  } catch (error) {
    // The existing profile loader owns ordinary root/parse diagnostics. A
    // StepSpace diagnostic is authoritative only after one exact ref parsed.
    if (error instanceof DefinitionStepAssemblyError) return { sources, diagnostics: [] };
    throw error;
  }
  const refs = sectionChildren(root).filter((section) => section.tag === 'StepSpaceRef');
  if (refs.length === 0) return { sources, diagnostics: [] };
  try {
    if (refs.length !== 1) fail('step-space-ref-duplicate', `${profileRoot} requires exactly one StepSpaceRef`, profileSourceRef);
    if (bodyChildren(root).length > 0) {
      fail('step-topology-authority-conflict', `${profileRoot} cannot combine inline executable nodes with StepSpaceRef`, profileSourceRef);
    }
    const refAttrs = exactAttrs(refs[0], ['src'], profileSourceRef);
    if (idOf(refs[0]) || bodyChildren(refs[0]).length > 0 || sectionChildren(refs[0]).length > 0) {
      fail('step-space-ref-invalid', 'StepSpaceRef must contain only src', profileSourceRef);
    }
    const forest = assembleDefinitionStepForest(
      { sources: runtime.sources, extensionCodecs: runtime.extensionCodecs },
      { stepSpaceRef: requiredString(refAttrs, 'src', profileSourceRef) },
      {},
    );
    const retainedSections = sectionChildren(root).filter((section) => section.tag !== 'StepSpaceRef');
    const projectedRoot = {
      ...root,
      body: forest.stepOrder.map((stepId) => forest.steps[stepId].core).map((core) => ({ core })),
    };
    const id = idOf(root);
    const metadata = Object.entries(root.metadata ?? {}).map(([key, value]) => `${key}=${serializeValue(value)}`).join(' ');
    const attrs = Object.entries(root.attributes ?? {}).map(([key, value]) => `${key}=${serializeValue(value)}`).join(' ');
    const sectionText = retainedSections.map(serializeElement).join(' ');
    const coreText = forest.stepOrder.map((stepId) => coreToXnl(forest.steps[stepId].core)).join(' ');
    const content = `<${root.tag}${id ? ` #${id}` : ''}${metadata ? ` ${metadata}` : ''}${attrs ? ` { ${attrs} }` : ''}${sectionText ? ` ( ${sectionText} )` : ''}${coreText ? ` [ ${coreText} ]` : ''}>`;
    const closureRefs = new Set(forest.closure.map((item) => item.ref));
    const projectedSources = entries
      .filter((source) => !closureRefs.has(source.ref))
      .map((source) => ({ ref: source.ref, content: source.ref === profileSourceRef ? content : source.content }));
    void projectedRoot;
    return { sources: projectedSources, forest, diagnostics: [] };
  } catch (error) {
    if (!(error instanceof DefinitionStepAssemblyError)) throw error;
    return { sources, diagnostics: [error.diagnostic] };
  }
}
