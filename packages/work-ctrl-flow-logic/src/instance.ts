/**
 * 流程实例物化 + status 标注视图（用户定稿设计）：
 * - 实例 = 定义 bundle 的冻结拷贝（含脚本），实例终身只从拷贝执行（定义修改不影响在途实例）。
 * - status 是引擎单向标注的视图，快照仍是真源；标注写在节点 { } 属性块里，用文本手术保留定义注释。
 * - 保留视图键：status / iterations / runStatus / tickNo（编译期剔除，见 instant-ctrl-flow compile）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadFlowBundle } from 'instant-ctrl-flow-logic/filesystem';
import { loadCtrlFlowProfileFromSources } from 'instant-ctrl-flow-logic';
import { projectWorkCtrlFlowInvocationOwners } from './engine.js';
import type { DefinitionStepAssemblyRuntime } from 'flow-step-space-logic';
import type { FlowNodeSpec } from 'instant-ctrl-flow-contract';
import {
  assembleDefinitionStepProfileDirectory,
  createFilesystemDefinitionStepProfileRuntime,
} from 'flow-step-space-logic/filesystem';
import {
  FLOW_INSTANCE_SCHEMA_VERSION,
  type FlowDefinitionProvenance,
  type FlowInstanceDescriptor,
  type NodeAnnotation,
  type NodeViewStatus,
  type TreeViewAnnotation,
} from 'work-ctrl-flow-contract';

export type { NodeAnnotation, NodeViewStatus, TreeViewAnnotation };

/** 把定义 bundle 递归拷贝为实例目录（冻结） */
export function materializeInstance(definitionDir: string, instanceDir: string): void {
  fs.mkdirSync(path.dirname(instanceDir), { recursive: true });
  fs.cpSync(definitionDir, instanceDir, { recursive: true });
}

export interface FlowInstanceSourceIdentity {
  readonly revision: string;
  readonly provenance: FlowDefinitionProvenance;
  readonly expectedDigest?: `sha256:${string}`;
}

export interface MaterializeFlowInstanceOptions {
  readonly definitionDir: string;
  readonly instancesDir: string;
  readonly instanceId: string;
  readonly source: FlowInstanceSourceIdentity;
  readonly materializedAtMs?: number;
  /** Product-owned schema validator; WorkCtrlFlow remains the compatibility default. */
  readonly validateDefinition?: FlowInstanceDefinitionValidator;
}

export type FlowInstanceDefinitionValidator = (definitionDir: string) => void;

export interface MaterializedFlowInstance {
  readonly instanceDir: string;
  readonly definitionDir: string;
  readonly descriptor: FlowInstanceDescriptor;
  readonly created: boolean;
}

/** Definition-admission projection used by the checkpoint owner for Ctrl membership. */
export function loadFrozenCtrlDefinitionMembership(
  definitionDir: string,
  profileKind: 'WorkCtrlFlow' | 'AICtrlWorkflow',
  extensionCodecs?: DefinitionStepAssemblyRuntime['extensionCodecs'],
): { readonly definitionStepIds: readonly string[]; readonly invocationOwners: Readonly<Record<string, string>> } {
  const runtime = createFilesystemDefinitionStepProfileRuntime({ rootDir: definitionDir, extensionCodecs });
  const assembled = assembleDefinitionStepProfileDirectory(runtime, {}, { profileRoot: profileKind });
  if (assembled.diagnostics.length > 0) {
    throw new FlowInstanceMaterializationError(
      'instance-definition-invalid',
      `frozen ${profileKind} StepSpace is invalid: ${assembled.diagnostics.map((item) => item.code).join(', ')}`,
    );
  }
  const profileSpec = profileKind === 'AICtrlWorkflow'
    ? loadCtrlFlowProfileFromSources(
        Object.fromEntries((assembled.sources as readonly ({ readonly ref: string; readonly content: string } | { readonly name: string; readonly content: string })[])
          .map((source) => ['name' in source ? source.name : source.ref, source.content])),
        { profileRoot: 'AICtrlWorkflow', substrateForm: 'WorkCtrlFlow' },
      ).spec
    : undefined;
  // The AICtrl runtime can also be bound to an already-canonical WorkCtrl
  // definition. That frozen substrate binding remains the membership authority.
  const spec = profileSpec ?? loadFlowBundle(definitionDir).spec;
  if (!spec) {
    throw new FlowInstanceMaterializationError('instance-definition-invalid', `frozen ${profileKind} binding is invalid`);
  }
  const ids: string[] = [];
  const visit = (node: FlowNodeSpec): void => {
    if (node.id) ids.push(node.id);
    node.children.forEach(visit);
    Object.values(node.sections).forEach(visit);
  };
  spec.statements.forEach(visit);
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new FlowInstanceMaterializationError(
      'instance-definition-step-identities-invalid',
      'frozen Ctrl binding must expose unique executable step identities',
    );
  }
  return Object.freeze({ definitionStepIds: Object.freeze(ids), invocationOwners: projectWorkCtrlFlowInvocationOwners(spec) });
}

export function loadFrozenCtrlDefinitionStepIds(definitionDir: string, profileKind: 'WorkCtrlFlow' | 'AICtrlWorkflow'): readonly string[] {
  return loadFrozenCtrlDefinitionMembership(definitionDir, profileKind).definitionStepIds;
}

export class FlowInstanceMaterializationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FlowInstanceMaterializationError';
  }
}

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

/** Closed path-independent source identity accepted before filesystem mutation. */
export function normalizeFlowInstanceSourceIdentity(value: unknown): FlowInstanceSourceIdentity {
  const record = exactDataRecord(value, ['revision', 'provenance'], ['expectedDigest'], 'source-identity-invalid');
  const revision = normalizedString(dataValue(record, 'revision', 'source-identity-invalid'), 'definition revision', 'source-identity-invalid');
  const provenance = normalizeDefinitionProvenance(
    dataValue(record, 'provenance', 'source-identity-invalid'),
    'source-identity-invalid',
  );
  const expectedDigestValue = Object.prototype.hasOwnProperty.call(record, 'expectedDigest')
    ? dataValue(record, 'expectedDigest', 'source-identity-invalid')
    : undefined;
  if (expectedDigestValue !== undefined
    && (typeof expectedDigestValue !== 'string' || !SHA256_DIGEST.test(expectedDigestValue))) {
    throw new FlowInstanceMaterializationError('source-identity-invalid', 'expectedDigest must be a lowercase sha256 digest');
  }
  return deepFreeze({
    revision,
    provenance,
    ...(expectedDigestValue === undefined ? {} : { expectedDigest: expectedDigestValue as `sha256:${string}` }),
  });
}

/** Exact closed-data normalizer for the persisted instance descriptor. */
export function normalizeFlowInstanceDescriptor(value: unknown): FlowInstanceDescriptor {
  const record = exactDataRecord(
    value,
    ['schemaVersion', 'instanceId', 'definition', 'materializedAtMs'],
    [],
    'instance-descriptor-invalid',
  );
  if (dataValue(record, 'schemaVersion', 'instance-descriptor-invalid') !== FLOW_INSTANCE_SCHEMA_VERSION) {
    throw new FlowInstanceMaterializationError('instance-descriptor-invalid', 'instance descriptor schemaVersion is invalid');
  }
  const instanceId = normalizedString(
    dataValue(record, 'instanceId', 'instance-descriptor-invalid'),
    'instanceId',
    'instance-descriptor-invalid',
  );
  assertSafeInstanceId(instanceId);
  const definitionRecord = exactDataRecord(
    dataValue(record, 'definition', 'instance-descriptor-invalid'),
    ['revision', 'digest', 'provenance'],
    [],
    'instance-descriptor-invalid',
  );
  const revision = normalizedString(
    dataValue(definitionRecord, 'revision', 'instance-descriptor-invalid'),
    'definition revision',
    'instance-descriptor-invalid',
  );
  const digest = dataValue(definitionRecord, 'digest', 'instance-descriptor-invalid');
  if (typeof digest !== 'string' || !SHA256_DIGEST.test(digest)) {
    throw new FlowInstanceMaterializationError('instance-descriptor-invalid', 'definition digest must be a lowercase sha256 digest');
  }
  const provenance = normalizeDefinitionProvenance(
    dataValue(definitionRecord, 'provenance', 'instance-descriptor-invalid'),
    'instance-descriptor-invalid',
  );
  const materializedAtMs = dataValue(record, 'materializedAtMs', 'instance-descriptor-invalid');
  if (typeof materializedAtMs !== 'number' || !Number.isSafeInteger(materializedAtMs) || materializedAtMs < 0) {
    throw new FlowInstanceMaterializationError('instance-descriptor-invalid', 'materializedAtMs must be a non-negative safe integer');
  }
  return deepFreeze({
    schemaVersion: FLOW_INSTANCE_SCHEMA_VERSION,
    instanceId,
    definition: { revision, digest: digest as `sha256:${string}`, provenance },
    materializedAtMs,
  });
}

const bundleDigests = new Map<string, {signature: string; digest: `sha256:${string}`}>();

/** Deterministic digest over relative paths, entry kinds and raw file bytes. */
export function computeFlowBundleDigest(definitionDir: string): `sha256:${string}` {
  const root = requireDirectory(definitionDir, 'definition-not-found');
  const entries = collectBundleEntries(root);
  // Check the physical entries on each read, but do not reread identical file
  // bytes for every checkpoint/query. ctime catches same-size writes even when
  // the caller restores mtime; directory entries catch additions/removals.
  const signature = JSON.stringify(entries.map(entry => {
    const stat = fs.lstatSync(entry.absolutePath, {bigint: true});
    return [entry.relativePath, entry.kind, String(stat.dev), String(stat.ino),
      String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)];
  }));
  const cached = bundleDigests.get(root);
  if (cached?.signature === signature) return cached.digest;
  const hash = createHash('sha256');
  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.relativePath, 'utf8');
    const pathLength = Buffer.allocUnsafe(4);
    pathLength.writeUInt32BE(pathBytes.length);
    hash.update(entry.kind === 'directory' ? 'd' : 'f');
    hash.update(pathLength);
    hash.update(pathBytes);
    if (entry.kind === 'file') {
      const bytes = fs.readFileSync(entry.absolutePath);
      const byteLength = Buffer.allocUnsafe(8);
      byteLength.writeBigUInt64BE(BigInt(bytes.length));
      hash.update(byteLength);
      hash.update(bytes);
    }
  }
  const digest: `sha256:${string}` = `sha256:${hash.digest('hex')}`;
  if (bundleDigests.size >= 128) bundleDigests.delete(bundleDigests.keys().next().value!);
  bundleDigests.set(root, {signature, digest});
  return digest;
}

/**
 * Creates a complete candidate, verifies bytes/schema/containment, then admits
 * the immutable instance with one same-parent rename.
 */
export function materializeFlowInstance(options: MaterializeFlowInstanceOptions): MaterializedFlowInstance {
  assertSafeInstanceId(options.instanceId);
  const source = normalizeFlowInstanceSourceIdentity(options.source);
  const materializedAtMs = nonNegativeSafeInteger(options.materializedAtMs ?? Date.now(), 'materializedAtMs');
  const sourceRoot = requireDirectory(options.definitionDir, 'definition-not-found');
  const requestedIdentity = requestedDefinitionIdentity(sourceRoot, source);
  const boundary = prepareInstancesBoundary(options.instancesDir);
  const instancesRoot = boundary.instancesRoot;
  const instanceDir = containedChild(instancesRoot, options.instanceId);
  assertInstancesBoundary(boundary);
  if (fs.existsSync(instanceDir)) {
    const admitted = loadMaterializedFlowInstance(
      instanceDir,
      options.instanceId,
      options.validateDefinition,
    );
    if (JSON.stringify(admitted.descriptor.definition) !== JSON.stringify(requestedIdentity)) {
      throw new FlowInstanceMaterializationError(
        'instance-source-identity-mismatch',
        'existing instance definition revision, digest or provenance differs from the requested source identity',
      );
    }
    return admitted;
  }

  const sourceDigest = requestedIdentity.digest;

  const candidateDir = containedChild(instancesRoot, `.candidate-${options.instanceId}-${randomUUID()}`);
  const candidateDefinitionDir = path.join(candidateDir, 'definition');
  try {
    assertInstancesBoundary(boundary);
    fs.mkdirSync(candidateDefinitionDir, { recursive: true });
    assertOwnedDirectory(candidateDir, boundary.realInstancesRoot, 'instance-candidate-boundary-invalid');
    copyBundle(sourceRoot, candidateDefinitionDir);
    assertBundleBytesEqual(sourceRoot, candidateDefinitionDir);
    const candidateDigest = computeFlowBundleDigest(candidateDefinitionDir);
    if (candidateDigest !== sourceDigest) {
      throw new FlowInstanceMaterializationError('candidate-digest-mismatch', 'candidate digest differs from source digest');
    }
    (options.validateDefinition ?? requireWorkCtrlFlowSchema)(candidateDefinitionDir);
    assertTreeContained(candidateDir);

    const descriptor: FlowInstanceDescriptor = deepFreeze({
      schemaVersion: FLOW_INSTANCE_SCHEMA_VERSION,
      instanceId: options.instanceId,
      definition: requestedIdentity,
      materializedAtMs,
    });
    assertInstancesBoundary(boundary);
    assertOwnedDirectory(candidateDir, boundary.realInstancesRoot, 'instance-candidate-boundary-invalid');
    fs.writeFileSync(path.join(candidateDir, 'instance.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
    const readback = readFlowInstanceDescriptor(candidateDir);
    if (JSON.stringify(readback) !== JSON.stringify(descriptor)) {
      throw new FlowInstanceMaterializationError('instance-readback-mismatch', 'instance descriptor readback differs');
    }
    assertInstancesBoundary(boundary);
    assertOwnedDirectory(candidateDir, boundary.realInstancesRoot, 'instance-candidate-boundary-invalid');
    if (fs.existsSync(instanceDir)) {
      throw new FlowInstanceMaterializationError('instance-admission-conflict', 'instance target appeared during admission');
    }
    fs.renameSync(candidateDir, instanceDir);
    assertInstancesBoundary(boundary);
    assertOwnedDirectory(instanceDir, boundary.realInstancesRoot, 'instance-boundary-invalid');
    const admitted = loadMaterializedFlowInstance(
      instanceDir,
      options.instanceId,
      options.validateDefinition,
    );
    return Object.freeze({ ...admitted, created: true });
  } catch (error) {
    removeOwnedCandidate(candidateDir, boundary);
    throw error;
  }
}

function requestedDefinitionIdentity(
  definitionDir: string,
  source: FlowInstanceSourceIdentity,
): FlowInstanceDescriptor['definition'] {
  const sourceDigest = computeFlowBundleDigest(definitionDir);
  if (source.expectedDigest !== undefined && source.expectedDigest !== sourceDigest) {
    throw new FlowInstanceMaterializationError(
      'definition-digest-mismatch',
      `definition digest ${sourceDigest} does not match expected ${source.expectedDigest}`,
    );
  }
  return deepFreeze({
    revision: source.revision,
    digest: sourceDigest,
    provenance: source.provenance,
  });
}

export function loadMaterializedFlowInstance(
  instanceDir: string,
  expectedInstanceId?: string,
  validateDefinition: FlowInstanceDefinitionValidator = requireWorkCtrlFlowSchema,
): MaterializedFlowInstance {
  const resolved = requireOwnedInstanceDirectory(instanceDir);
  const descriptor = readFlowInstanceDescriptor(resolved);
  if (expectedInstanceId !== undefined && descriptor.instanceId !== expectedInstanceId) {
    throw new FlowInstanceMaterializationError('instance-id-mismatch', 'instance descriptor identity differs from requested instance');
  }
  const definitionPath = path.join(resolved, 'definition');
  let definitionStat: fs.Stats;
  try {
    definitionStat = fs.lstatSync(definitionPath);
  } catch {
    throw new FlowInstanceMaterializationError('instance-definition-not-found', 'frozen definition directory does not exist');
  }
  if (definitionStat.isSymbolicLink()) {
    throw new FlowInstanceMaterializationError('bundle-link-unsupported', 'frozen definition must not be a symbolic link');
  }
  const definitionDir = requireDirectory(definitionPath, 'instance-definition-not-found');
  // runs/ is mutable checkpoint support. Only the frozen definition subtree
  // participates in instance artifact containment and digest verification.
  // computeFlowBundleDigest walks the physical tree and rejects every symlink;
  // a second traversal/realpath of all those same entries adds no containment.
  const digest = computeFlowBundleDigest(definitionDir);
  if (digest !== descriptor.definition.digest) {
    throw new FlowInstanceMaterializationError('instance-definition-digest-mismatch', 'frozen definition digest differs from instance descriptor');
  }
  validateDefinition(definitionDir);
  return Object.freeze({ instanceDir: resolved, definitionDir, descriptor, created: false });
}

export function readFlowInstanceDescriptor(instanceDir: string): FlowInstanceDescriptor {
  const resolved = requireOwnedInstanceDirectory(instanceDir);
  const file = path.join(resolved, 'instance.json');
  let value: unknown;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('descriptor must be a regular no-link file');
    value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    throw new FlowInstanceMaterializationError('instance-descriptor-invalid', `cannot read instance descriptor: ${(error as Error).message}`);
  }
  return normalizeFlowInstanceDescriptor(value);
}

type InstancesPhysicalBoundary = {
  readonly supportRoot: string;
  readonly realSupportRoot: string;
  readonly instancesRoot: string;
  readonly realInstancesRoot: string;
};

function prepareInstancesBoundary(value: string): InstancesPhysicalBoundary {
  const instancesRoot = path.resolve(value);
  const supportRoot = path.dirname(instancesRoot);
  const realSupportRoot = requireNoLinkDirectory(supportRoot, 'instance-support-boundary-invalid');
  if (!fs.existsSync(instancesRoot)) {
    fs.mkdirSync(instancesRoot);
  }
  const realInstancesRoot = requireNoLinkDirectory(instancesRoot, 'instance-instances-boundary-invalid');
  assertRealChild(realSupportRoot, realInstancesRoot, 'instance-instances-boundary-invalid');
  const boundary = { supportRoot, realSupportRoot, instancesRoot, realInstancesRoot };
  assertInstancesBoundary(boundary);
  return boundary;
}

function assertInstancesBoundary(boundary: InstancesPhysicalBoundary): void {
  const currentSupport = requireNoLinkDirectory(boundary.supportRoot, 'instance-support-boundary-invalid');
  if (currentSupport !== boundary.realSupportRoot) {
    throw new FlowInstanceMaterializationError('instance-support-boundary-invalid', 'support root identity changed during instance operation');
  }
  const currentInstances = requireNoLinkDirectory(boundary.instancesRoot, 'instance-instances-boundary-invalid');
  if (currentInstances !== boundary.realInstancesRoot) {
    throw new FlowInstanceMaterializationError('instance-instances-boundary-invalid', 'instances root identity changed during instance operation');
  }
  assertRealChild(boundary.realSupportRoot, currentInstances, 'instance-instances-boundary-invalid');
}

function requireOwnedInstanceDirectory(value: string): string {
  const instanceDir = path.resolve(value);
  const instancesRoot = path.dirname(instanceDir);
  const supportRoot = path.dirname(instancesRoot);
  const realSupportRoot = requireNoLinkDirectory(supportRoot, 'instance-support-boundary-invalid');
  const realInstancesRoot = requireNoLinkDirectory(instancesRoot, 'instance-instances-boundary-invalid');
  assertRealChild(realSupportRoot, realInstancesRoot, 'instance-instances-boundary-invalid');
  return assertOwnedDirectory(instanceDir, realInstancesRoot, 'instance-boundary-invalid');
}

function requireNoLinkDirectory(value: string, code: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(value);
  } catch {
    throw new FlowInstanceMaterializationError(code, 'required physical directory does not exist');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new FlowInstanceMaterializationError(code, 'physical boundary must be a no-link directory');
  }
  return fs.realpathSync(value);
}

function assertOwnedDirectory(value: string, realParent: string, code: string): string {
  const realValue = requireNoLinkDirectory(value, code);
  assertRealChild(realParent, realValue, code);
  return realValue;
}

function assertRealChild(realParent: string, realChild: string, code: string): void {
  const relative = path.relative(realParent, realChild);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FlowInstanceMaterializationError(code, 'physical directory escapes its owner boundary');
  }
}

function removeOwnedCandidate(candidateDir: string, boundary: InstancesPhysicalBoundary): void {
  if (!fs.existsSync(candidateDir)) return;
  try {
    assertInstancesBoundary(boundary);
    assertOwnedDirectory(candidateDir, boundary.realInstancesRoot, 'instance-candidate-boundary-invalid');
    fs.rmSync(candidateDir, { recursive: true, force: true });
  } catch {
    // Cleanup must never cross a changed physical owner boundary. A contained
    // candidate can be recovered by a later owner after the boundary is valid.
  }
}

type BundleEntry = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly kind: 'directory' | 'file';
};

function collectBundleEntries(root: string): BundleEntry[] {
  const entries: BundleEntry[] = [];
  const visit = (current: string) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => compareCodeUnits(left.name, right.name))) {
      const absolutePath = path.join(current, item.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
        throw new FlowInstanceMaterializationError('bundle-containment-invalid', `bundle entry escapes root: ${relativePath}`);
      }
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new FlowInstanceMaterializationError('bundle-link-unsupported', `bundle entry must not be a symbolic link: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        entries.push({ absolutePath, relativePath, kind: 'directory' });
        visit(absolutePath);
      } else if (stat.isFile()) {
        entries.push({ absolutePath, relativePath, kind: 'file' });
      } else {
        throw new FlowInstanceMaterializationError('bundle-entry-unsupported', `unsupported bundle entry: ${relativePath}`);
      }
    }
  };
  visit(root);
  return entries.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
}

function copyBundle(sourceRoot: string, targetRoot: string): void {
  for (const entry of collectBundleEntries(sourceRoot)) {
    const target = path.join(targetRoot, ...entry.relativePath.split('/'));
    if (entry.kind === 'directory') fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(entry.absolutePath, target);
    }
  }
}

function assertBundleBytesEqual(sourceRoot: string, targetRoot: string): void {
  const sourceEntries = collectBundleEntries(sourceRoot);
  const targetEntries = collectBundleEntries(targetRoot);
  const sourceShape = sourceEntries.map(({ relativePath, kind }) => ({ relativePath, kind }));
  const targetShape = targetEntries.map(({ relativePath, kind }) => ({ relativePath, kind }));
  if (JSON.stringify(sourceShape) !== JSON.stringify(targetShape)) {
    throw new FlowInstanceMaterializationError('candidate-shape-mismatch', 'candidate entries differ from source entries');
  }
  for (const entry of sourceEntries) {
    if (entry.kind !== 'file') continue;
    const target = path.join(targetRoot, ...entry.relativePath.split('/'));
    if (!fs.readFileSync(entry.absolutePath).equals(fs.readFileSync(target))) {
      throw new FlowInstanceMaterializationError('candidate-byte-mismatch', `candidate bytes differ for ${entry.relativePath}`);
    }
  }
}

function requireWorkCtrlFlowSchema(definitionDir: string): void {
  const loaded = loadFlowBundle(definitionDir);
  const hard = loaded.diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
  if (!loaded.spec || hard.length > 0 || loaded.spec.form !== 'WorkCtrlFlow') {
    throw new FlowInstanceMaterializationError(
      'definition-schema-invalid',
      loaded.diagnostics.map((diagnostic) => `[${diagnostic.code}] ${diagnostic.message}`).join('; ') || 'definition is not a WorkCtrlFlow',
    );
  }
}

function assertTreeContained(root: string): void {
  const realRoot = fs.realpathSync(root);
  for (const entry of collectBundleEntries(realRoot)) {
    const realEntry = fs.realpathSync(entry.absolutePath);
    const relative = path.relative(realRoot, realEntry);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new FlowInstanceMaterializationError('bundle-containment-invalid', `entry escapes admitted root: ${entry.relativePath}`);
    }
  }
}

function requireDirectory(value: string, code: string): string {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new FlowInstanceMaterializationError(code, `directory does not exist: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function containedChild(root: string, segment: string): string {
  const target = path.resolve(root, segment);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FlowInstanceMaterializationError('instance-containment-invalid', 'instance path escapes instances root');
  }
  return target;
}

function assertSafeInstanceId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === '.' || value === '..') {
    throw new FlowInstanceMaterializationError('instance-id-invalid', 'instanceId must be one safe path segment');
  }
}

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new FlowInstanceMaterializationError('source-identity-invalid', `${name} must be non-negative`);
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function normalizeDefinitionProvenance(value: unknown, code: string): FlowDefinitionProvenance {
  const record = exactDataRecord(value, ['authority', 'artifactRef'], ['metadata'], code);
  const authority = normalizedString(dataValue(record, 'authority', code), 'provenance authority', code);
  const artifactRef = normalizedString(dataValue(record, 'artifactRef', code), 'provenance artifactRef', code);
  const metadata = Object.prototype.hasOwnProperty.call(record, 'metadata')
    ? cloneClosedObject(dataValue(record, 'metadata', code), code)
    : undefined;
  return deepFreeze({ authority, artifactRef, ...(metadata === undefined ? {} : { metadata }) });
}

function exactDataRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FlowInstanceMaterializationError(code, 'expected a plain-data object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FlowInstanceMaterializationError(code, 'expected a plain-data object');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw new FlowInstanceMaterializationError(code, 'symbol fields are not closed data');
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FlowInstanceMaterializationError(code, 'fields must be enumerable data properties');
    }
    if (!allowed.has(key)) throw new FlowInstanceMaterializationError(code, `unsupported field: ${key}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new FlowInstanceMaterializationError(code, `required field is missing: ${key}`);
    }
  }
  return value as Record<string, unknown>;
}

function dataValue(record: Record<string, unknown>, field: string, code: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    throw new FlowInstanceMaterializationError(code, `field must be an enumerable data property: ${field}`);
  }
  return descriptor.value;
}

function normalizedString(value: unknown, name: string, code: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new FlowInstanceMaterializationError(code, `${name} must be a non-empty canonical string`);
  }
  return value;
}

function cloneClosedObject(value: unknown, code: string): FlowDefinitionProvenance['metadata'] {
  const cloned = cloneClosedValue(value, code);
  if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
    throw new FlowInstanceMaterializationError(code, 'metadata must be a closed plain-data object');
  }
  return cloned as FlowDefinitionProvenance['metadata'];
}

function cloneClosedValue(value: unknown, code: string, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new FlowInstanceMaterializationError(code, 'closed-data numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new FlowInstanceMaterializationError(code, 'value is not closed data');
  if (ancestors.has(value)) throw new FlowInstanceMaterializationError(code, 'closed data must not contain cycles');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new FlowInstanceMaterializationError(code, 'closed arrays must use the standard prototype');
      }
      const keys = Reflect.ownKeys(value);
      const expected = new Set<string>(['length']);
      for (let index = 0; index < value.length; index += 1) expected.add(String(index));
      if (keys.length !== expected.size
        || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
        throw new FlowInstanceMaterializationError(code, 'closed arrays must be dense without extra fields');
      }
      return Object.freeze(value.map((_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new FlowInstanceMaterializationError(code, 'array entries must be enumerable data properties');
        }
        return cloneClosedValue(descriptor.value, code, ancestors);
      }));
    }
    const record = exactClosedRecord(value, code);
    const output: Record<string, unknown> = {};
    for (const key of (Reflect.ownKeys(record) as string[]).sort(compareCodeUnits)) {
      output[key] = cloneClosedValue(dataValue(record, key, code), code, ancestors);
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

function exactClosedRecord(value: object, code: string): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FlowInstanceMaterializationError(code, 'closed objects must use a plain prototype');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw new FlowInstanceMaterializationError(code, 'symbol fields are not closed data');
  }
  for (const key of keys as string[]) dataValue(value as Record<string, unknown>, key, code);
  return value as Record<string, unknown>;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const VIEW_ATTR_RE = /\s*(?:status|iterations|runStatus|tickNo)\s*=\s*(?:"[^"]*"|[\w.]+)/g;

/** 移除既往注入的视图键（仅 manifest.xnl 使用；task.space 的 status 是真实 DSL 字段，走 replace 路径） */
export function stripViewAttrs(text: string): string {
  let out = text.replace(VIEW_ATTR_RE, '');
  // 清理注入后可能残留的空属性块 "{ }"（仅当它是我们注入的——定义里不写空块）
  out = out.replace(/\s*\{\s*\}(?=\s*[([>])/g, '');
  return out;
}

const fmt = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v}"`);

/**
 * 在 `<Tag #id` 之后的 { } 属性块头部注入键值（无属性块则新建）。
 * 依赖校验器保证的不变量：树内 #id 唯一。
 */
function injectAttrs(text: string, id: string, entries: Record<string, string | number>): string {
  const pairs = Object.entries(entries)
    .map(([k, v]) => `${k} = ${fmt(v)}`)
    .join(' ');
  if (!pairs) return text;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(<[\\w.]+\\s+#${esc})(?![\\w.-])`);
  const m = re.exec(text);
  if (!m) return text; // 节点在实例树中不存在（不应发生）——视图尽力而为，不抛错
  let i = m.index + m[0].length;
  // 跳过元数据位 key=value（tree 节点通常没有；容错处理）
  const metaRe = /^\s+[A-Za-z_][\w.]*\s*=\s*(?:"[^"]*"|[\w.]+)/y;
  for (;;) {
    metaRe.lastIndex = i;
    const mm = metaRe.exec(text);
    if (!mm) break;
    i = metaRe.lastIndex;
  }
  const rest = text.slice(i);
  const nextStructural = rest.search(/[{([>]/);
  const ch = rest[nextStructural];
  if (ch === '{') {
    const at = i + nextStructural + 1;
    return text.slice(0, at) + ` ${pairs}` + text.slice(at);
  }
  const at = i + nextStructural;
  return text.slice(0, at) + `{ ${pairs} } ` + text.slice(at);
}

/** 把状态视图写回实例 manifest.xnl（幂等：先剥离旧视图键再注入） */
export function annotateFlowFile(instanceDir: string, view: TreeViewAnnotation): void {
  const file = path.join(instanceDir, 'manifest.xnl');
  if (!fs.existsSync(file)) return;
  let text = stripViewAttrs(fs.readFileSync(file, 'utf8'));
  const flowRoot = /(<(?:WorkCtrlFlow|BPCtrlFlow)(?:\s+#[\w.-]+)?)/.exec(text);
  if (flowRoot) {
    const at = flowRoot.index + flowRoot[0].length;
    const rest = text.slice(at);
    const next = rest.search(/[{([>]/);
    if (rest[next] === '{') {
      const p = at + next + 1;
      text = text.slice(0, p) + ` runStatus = "${view.runStatus}" tickNo = ${view.tickNo}` + text.slice(p);
    } else {
      const p = at + next;
      text = text.slice(0, p) + `{ runStatus = "${view.runStatus}" tickNo = ${view.tickNo} } ` + text.slice(p);
    }
  }
  for (const [id, a] of Object.entries(view.nodes)) {
    const entries: Record<string, string | number> = { status: a.status };
    if (a.iterations !== undefined) entries.iterations = a.iterations;
    text = injectAttrs(text, id, entries);
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);

  const assembled = assembleDefinitionStepProfileDirectory(
    createFilesystemDefinitionStepProfileRuntime({ rootDir: instanceDir }),
    {},
    { profileRoot: 'WorkCtrlFlow' },
  );
  if (!assembled.forest || assembled.diagnostics.length > 0) return;
  for (const stepId of assembled.forest.stepOrder) {
    const stepFile = path.join(instanceDir, ...assembled.forest.steps[stepId].sourceRef.split('/'));
    let stepText = stripViewAttrs(fs.readFileSync(stepFile, 'utf8'));
    const coreOffset = stepText.indexOf('<Core');
    const prefix = coreOffset >= 0 ? stepText.slice(0, coreOffset) : '';
    let coreText = coreOffset >= 0 ? stepText.slice(coreOffset) : stepText;
    for (const [id, annotation] of Object.entries(view.nodes)) {
      const entries: Record<string, string | number> = { status: annotation.status };
      if (annotation.iterations !== undefined) entries.iterations = annotation.iterations;
      coreText = injectAttrs(coreText, id, entries);
    }
    stepText = `${prefix}${coreText}`;
    const stepTmp = `${stepFile}.tmp`;
    fs.writeFileSync(stepTmp, stepText);
    fs.renameSync(stepTmp, stepFile);
  }
}

/** BPCtrlFlow：把任务状态机现值同步进实例 task.space.xnl（替换既有 status 值；真源在 TaskSpaceStore） */
export function annotateTaskSpaceFile(instanceDir: string, taskStatuses: Record<string, string>): void {
  const file = path.join(instanceDir, 'task.space.xnl');
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8');
  for (const [id, status] of Object.entries(taskStatuses)) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(<Task\\s+#${esc}(?![\\w.-])[\\s\\S]*?status\\s*=\\s*")[A-Za-z_]+(")`), `$1${status}$2`);
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
