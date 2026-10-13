import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  AIWorkflowFlowRunCheckpoint,
  FlowClosedObject,
  FlowClosedValue,
  FlowDefinitionArtifactIdentity,
  FlowRunCheckpointCommit,
  FlowRunCheckpointKey,
  FlowRunCheckpointRuntime,
  FlowRunCheckpointStore,
  FlowRunProfileState,
} from 'ai-workflow-contract';
import type { WorkCtrlFlowSnapshot } from 'work-ctrl-flow-contract';
import {
  createMaterializedWorkCtrlFlowEngineFromDirectory,
  loadFrozenCtrlDefinitionStepIds,
  loadFrozenCtrlDefinitionMembership,
  loadMaterializedFlowInstance,
  materializeFlowInstance,
  type MaterializedWorkCtrlFlowDirectoryOptions,
} from 'work-ctrl-flow-logic';
import {
  createWorkCtrlFlowCheckpointStore,
  FlowRunCheckpointTransitionError,
  FlowRunCheckpointVersionConflictError,
  validateFlowRunCheckpointTransition,
} from './checkpoint-store.js';
import {
  normalizeFlowInstanceDescriptor,
  normalizeFlowClosedObject,
  normalizeFlowRunCheckpoint,
} from './run-checkpoint.js';
import {
  checkpointHeadJson,
  createDirectoryDurably,
  encodeCheckpointSidecars,
  isCheckpointHead,
  persistCheckpointSidecars,
  readCheckpointHeadAndLogical,
  renameDurably,
  writeDurableCandidate,
  type CheckpointDurabilityRuntime,
  type FlowRunCheckpointHead,
} from './checkpoint-sidecar.js';
import type { StepMerkleTree } from 'flow-step-space-contract';
import type { DefinitionStepExtensionCodecRegistryPort } from 'flow-step-space-contract';
import {
  validateCheckpointAgainstFrozenProfile,
  type FlowRunProfileAuthorityPort,
} from './checkpoint-profile.js';

const CHECKPOINT_FILE = 'checkpoint.json';
const CHECKPOINT_STAGING_FILE = 'checkpoint.staging.json';
const CHECKPOINT_LOCK_FILE = 'checkpoint.lock';
const RUN_INDEX_FILE = 'run-index.json';
const RUN_INDEX_STAGING_FILE = 'run-index.staging.json';
const RUN_INDEX_LOCK_FILE = 'run-index.lock';
const LEGACY_IMPORT_RECEIPT_FILE = 'legacy-import.receipt.json';
const LEGACY_IMPORT_RECEIPT_STAGING_FILE = 'legacy-import.receipt.staging.json';
const LOCK_RETRY_MS = 2;
const LOCK_TIMEOUT_MS = 5_000;
const ABANDONED_INCOMPLETE_LOCK_MS = 30_000;
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

export interface FilesystemFlowRunCheckpointStoreOptions {
  /** Injected support root; the domain contract never derives a host path. */
  readonly storeRoot: string;
  readonly durability?: CheckpointDurabilityRuntime;
  readonly profileAuthority?: FlowRunProfileAuthorityPort;
  readonly extensionCodecs?: DefinitionStepExtensionCodecRegistryPort;
}

export interface FilesystemFlowRunCheckpointRuntime {
  readonly storage: FilesystemFlowRunCheckpointStoreOptions;
}

export interface CreateFilesystemFlowRunCheckpointStoreInput {}
export interface CreateFilesystemFlowRunCheckpointStoreConfig {}

export function createFilesystemFlowRunCheckpointRuntime(
  options: FilesystemFlowRunCheckpointStoreOptions,
): FilesystemFlowRunCheckpointRuntime {
  return Object.freeze({ storage: Object.freeze({ ...options }) });
}

/** Processor authority; host root policy is injected only through runtime.storage. */
export function createFilesystemFlowRunCheckpointStore(
  runtime: FilesystemFlowRunCheckpointRuntime,
  _input: CreateFilesystemFlowRunCheckpointStoreInput,
  _config: CreateFilesystemFlowRunCheckpointStoreConfig,
): FilesystemFlowRunCheckpointStore {
  return new FilesystemFlowRunCheckpointStore(runtime.storage);
}

export interface CanonicalMaterializedWorkCtrlFlowOptions
  extends Omit<MaterializedWorkCtrlFlowDirectoryOptions, 'store' | 'instancesDir' | 'instanceId'> {
  readonly storeRoot: string;
  readonly instanceId: string;
  readonly checkpointConfig: FlowClosedValue;
  readonly projectCheckpointOutput?: (snapshot: WorkCtrlFlowSnapshot) => FlowClosedValue;
}

/** Canonical WorkCtrl filesystem facade: frozen instance plus one checkpoint owner. */
export function createCanonicalMaterializedWorkCtrlFlowEngine(
  options: CanonicalMaterializedWorkCtrlFlowOptions,
) {
  const instancesDir = path.join(options.storeRoot, 'instances');
  const instanceDir = path.join(instancesDir, options.instanceId);
  const instance = fs.existsSync(instanceDir)
    ? loadMaterializedFlowInstance(instanceDir, options.instanceId)
    : options.bundleDir && options.source
      ? materializeFlowInstance({
          definitionDir: options.bundleDir,
          instancesDir,
          instanceId: options.instanceId,
          source: options.source,
          materializedAtMs: options.clock?.now(),
        })
      : (() => {
          if (options.bundleDir || options.source) {
            throw new FlowRunFilesystemStoreError(
              'flow-run-instance-source-incomplete',
              'bundleDir and source identity must be provided together.',
            );
          }
          throw new FlowRunFilesystemStoreError(
            'flow-run-instance-source-required',
            'bundleDir and source identity are required to admit a new canonical WorkCtrl instance.',
          );
        })();
  const checkpointStore = createFilesystemFlowRunCheckpointStore(
    createFilesystemFlowRunCheckpointRuntime({ storeRoot: options.storeRoot }),
    {},
    {},
  );
  const store = createWorkCtrlFlowCheckpointStore(
    { checkpointStore },
    {
      instanceId: options.instanceId,
      definition: instance.descriptor.definition,
      config: options.checkpointConfig,
      ...(options.projectCheckpointOutput
        ? { projectOutput: options.projectCheckpointOutput }
        : {}),
    },
  );
  const {
    storeRoot: _storeRoot,
    checkpointConfig: _checkpointConfig,
    projectCheckpointOutput: _projectCheckpointOutput,
    bundleDir: _bundleDir,
    source: _source,
    ...engineOptions
  } = options;
  return createMaterializedWorkCtrlFlowEngineFromDirectory({
    ...engineOptions,
    instancesDir,
    instanceId: options.instanceId,
    store,
  });
}

export interface FlowRunIndexEntry {
  readonly instanceId: string;
  readonly runId: string;
  readonly version: number;
  readonly definitionRevision: string;
  readonly definitionDigest: `sha256:${string}`;
  readonly profileKind: FlowRunProfileState['kind'];
}

export interface FlowRunIndexProjection {
  readonly schemaVersion: 'depa.flow-run-index/v1';
  readonly entries: readonly FlowRunIndexEntry[];
}

export interface LegacyWorkCtrlSnapshotIdentity {
  readonly treeId: string;
  readonly digest: `sha256:${string}`;
}

export interface LegacyWorkCtrlSnapshotRead {
  readonly identity: LegacyWorkCtrlSnapshotIdentity;
  readonly snapshot: WorkCtrlFlowSnapshot;
}

export interface LegacyWorkCtrlSnapshotReader {
  read(treeId: string): Promise<LegacyWorkCtrlSnapshotRead | undefined>;
}

export interface LegacyWorkCtrlCheckpointConversionOptions {
  readonly target: FlowRunCheckpointKey;
  readonly definition: FlowDefinitionArtifactIdentity;
  readonly config: FlowClosedValue;
  readonly output?: FlowClosedValue;
}

export interface LegacyWorkCtrlImportReceipt {
  readonly schemaVersion: 'depa.flow-legacy-import-receipt/v1';
  readonly legacyTreeId: string;
  readonly legacySnapshotDigest: `sha256:${string}`;
  readonly target: FlowRunCheckpointKey;
  readonly definitionRevision: string;
  readonly definitionDigest: `sha256:${string}`;
  readonly acceptedCheckpointVersion: 0;
  readonly acceptedCheckpointDigest: `sha256:${string}`;
}

export interface LegacyWorkCtrlImportRuntime extends FlowRunCheckpointRuntime {
  readonly checkpointStore: FilesystemFlowRunCheckpointStore;
  readonly legacyReader: LegacyWorkCtrlSnapshotReader;
}

export interface ImportLegacyWorkCtrlSnapshotInput
  extends Omit<LegacyWorkCtrlCheckpointConversionOptions, 'target'> {
  readonly legacyTreeId: string;
  readonly target: FlowRunCheckpointKey;
}

export class FlowRunFilesystemStoreError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FlowRunFilesystemStoreError';
  }
}

export class LegacyWorkCtrlImportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LegacyWorkCtrlImportError';
  }
}

export class LegacyWorkCtrlImportConflictError extends LegacyWorkCtrlImportError {
  constructor(message: string) {
    super('legacy-work-ctrl-import-conflict', message);
    this.name = 'LegacyWorkCtrlImportConflictError';
  }
}

type HeldLock = {
  readonly fd: number;
  readonly file: string;
  readonly token: string;
  readonly device: number;
  readonly inode: number;
};

type LockObservation = {
  readonly device: number;
  readonly inode: number;
  readonly mtimeMs: number;
  readonly pid: number | undefined;
  readonly token: string | undefined;
  readonly createdAtMs: number | undefined;
};

type FlowRunFilesystemLocations = {
  readonly instancesDir: string;
  readonly instanceDir: string;
  readonly runsDir: string;
  readonly runDir: string;
  readonly checkpointFile: string;
  readonly stagingFile: string;
  readonly lockFile: string;
};

/** Reference Node filesystem support for the canonical FlowRunCheckpoint port. */
export class FilesystemFlowRunCheckpointStore implements FlowRunCheckpointStore<FlowRunProfileState> {
  readonly #storeRoot: string;
  readonly #realStoreRoot: string;
  readonly #durability: CheckpointDurabilityRuntime | undefined;
  readonly #profileAuthority: FlowRunProfileAuthorityPort | undefined;
  readonly #extensionCodecs: DefinitionStepExtensionCodecRegistryPort;

  constructor(options: FilesystemFlowRunCheckpointStoreOptions) {
    const root = path.resolve(options.storeRoot);
    assertExistingDirectory(root, undefined, 'flow-run-store-root-invalid');
    this.#storeRoot = root;
    this.#realStoreRoot = fs.realpathSync(root);
    this.#durability = options.durability;
    this.#profileAuthority = options.profileAuthority;
    this.#extensionCodecs = options.extensionCodecs ?? Object.freeze({ resolve: () => undefined });
  }

  async load(key: FlowRunCheckpointKey): Promise<AIWorkflowFlowRunCheckpoint | undefined> {
    const locations = this.#locations(key);
    this.#preflightExistingRunBoundary(locations);
    const descriptor = this.#requireInstance(locations.instanceDir, key.instanceId);
    if (!fs.existsSync(locations.runsDir)) return undefined;
    assertExistingDirectory(locations.runsDir, this.#realStoreRoot, 'flow-run-boundary-invalid');
    if (!fs.existsSync(locations.runDir)) return undefined;
    assertExistingDirectory(locations.runDir, this.#realStoreRoot, 'flow-run-symlink-boundary');
    if (!fs.existsSync(locations.checkpointFile)) return undefined;
    const checkpoint = this.#readStorage(locations.checkpointFile).checkpoint;
    this.#assertCheckpointIdentity(checkpoint, key, descriptor.definition);
    this.#validateFrozenProfile(checkpoint);
    return checkpoint;
  }

  async commit(input: FlowRunCheckpointCommit<FlowRunProfileState>): Promise<AIWorkflowFlowRunCheckpoint> {
    // Program data and logical ids are validated before filesystem mutation.
    const checkpoint = normalizeFlowRunCheckpoint(input.checkpoint);
    assertSafeSegment(checkpoint.instanceId);
    assertSafeSegment(checkpoint.runId);
    const key = { instanceId: checkpoint.instanceId, runId: checkpoint.runId };
    const locations = this.#locations(key);
    this.#preflightExistingRunBoundary(locations);
    const descriptor = this.#requireInstance(locations.instanceDir, key.instanceId);
    this.#assertCheckpointIdentity(checkpoint, key, descriptor.definition);
    const frozenAuthority = this.#validateFrozenProfile(checkpoint);

    this.#ensureRunDirectory(locations);
    const lock = await acquireLock(locations.runDir, locations.lockFile, this.#realStoreRoot);
    try {
      this.#assertRunPhysicalBoundary(locations);
      removeUncommittedStaging(locations.stagingFile, locations.runDir, this.#realStoreRoot);
      const currentStorage = fs.existsSync(locations.checkpointFile)
        ? this.#readStorage(locations.checkpointFile)
        : undefined;
      const current = currentStorage?.checkpoint;
      if (current) {
        this.#assertCheckpointIdentity(current, key, descriptor.definition);
        this.#validateFrozenProfile(current);
      }
      const actualVersion = current?.version ?? null;
      if (actualVersion !== input.expectedVersion) {
        throw new FlowRunCheckpointVersionConflictError(input.expectedVersion, actualVersion);
      }
      validateFlowRunCheckpointTransition(current, checkpoint);
      ensureSidecarDirectories(locations.runDir, this.#realStoreRoot, this.#durability);
      const definitionStepIds = frozenAuthority?.definitionStepIds ?? (checkpoint.profile.kind === 'AIDataWorkflow'
        ? undefined
        : loadFrozenCtrlDefinitionStepIds(
            path.join(locations.instanceDir, 'definition'),
            checkpoint.profile.kind,
          ));
      const encoded = encodeCheckpointSidecars(checkpoint, currentStorage?.tree, {
        definitionStepIds,
        ...(checkpoint.profile.kind === 'AIDataWorkflow' ? {} : { definitionInvocationOwners: frozenAuthority?.definitionInvocationOwners
          ?? loadFrozenCtrlDefinitionMembership(path.join(locations.instanceDir, 'definition'), checkpoint.profile.kind, this.#extensionCodecs).invocationOwners }),
        previousMaterialRecordDigests: currentStorage?.materialRecordDigests,
      });
      removeUnacceptedSidecarReceipt(locations.runDir, checkpoint.version, this.#realStoreRoot);
      persistCheckpointSidecars(locations.runDir, encoded, this.#durability);
      assertSidecarDirectories(locations.runDir, this.#realStoreRoot);
      writeCheckpointCandidate(locations.stagingFile, encoded.head, this.#realStoreRoot, this.#durability);
      const staged = this.#readStorage(locations.stagingFile).checkpoint;
      this.#assertCheckpointIdentity(staged, key, descriptor.definition);
      this.#validateFrozenProfile(staged);
      if (stableJson(staged) !== stableJson(checkpoint)) {
        throw new FlowRunFilesystemStoreError(
          'flow-run-checkpoint-readback-mismatch',
          'Checkpoint staging readback differs from the normalized transition.',
        );
      }
      this.#assertRunPhysicalBoundary(locations);
      assertRegularFile(locations.stagingFile, this.#realStoreRoot, 'flow-run-staging-invalid');
      if (fs.existsSync(locations.checkpointFile)) {
        assertRegularFile(locations.checkpointFile, this.#realStoreRoot, 'flow-run-checkpoint-invalid');
      }
      renameDurably(locations.stagingFile, locations.checkpointFile, 'head', this.#durability);
      const accepted = this.#readStorage(locations.checkpointFile).checkpoint;
      this.#assertCheckpointIdentity(accepted, key, descriptor.definition);
      this.#validateFrozenProfile(accepted);
      if (stableJson(accepted) !== stableJson(checkpoint)) {
        throw new FlowRunFilesystemStoreError(
          'flow-run-checkpoint-readback-mismatch',
          'Accepted checkpoint readback differs from the normalized transition.',
        );
      }
      return accepted;
    } finally {
      releaseLock(lock, locations.runDir, this.#realStoreRoot);
    }
  }

  /** Rebuildable observation only; it never writes a checkpoint. */
  async rebuildRunIndex(): Promise<FlowRunIndexProjection> {
    const instancesDir = path.join(this.#storeRoot, 'instances');
    const entries: FlowRunIndexEntry[] = [];
    if (fs.existsSync(instancesDir)) {
      assertExistingDirectory(instancesDir, this.#realStoreRoot, 'flow-run-boundary-invalid');
      for (const instanceEntry of readDirectoryCodeUnitOrdered(instancesDir)) {
        if (instanceEntry.name.startsWith('.candidate-')) continue;
        if (!instanceEntry.isDirectory() || instanceEntry.isSymbolicLink()) {
          throw new FlowRunFilesystemStoreError('flow-run-index-entry-invalid', 'Instance index entries must be directories.');
        }
        assertSafeSegment(instanceEntry.name);
        const instanceDir = path.join(instancesDir, instanceEntry.name);
        const descriptor = this.#requireInstance(instanceDir, instanceEntry.name);
        const runsDir = path.join(instanceDir, 'runs');
        if (!fs.existsSync(runsDir)) continue;
        assertExistingDirectory(runsDir, this.#realStoreRoot, 'flow-run-boundary-invalid');
        for (const runEntry of readDirectoryCodeUnitOrdered(runsDir)) {
          if (!runEntry.isDirectory() || runEntry.isSymbolicLink()) {
            throw new FlowRunFilesystemStoreError('flow-run-index-entry-invalid', 'Run index entries must be directories.');
          }
          assertSafeSegment(runEntry.name);
          const checkpoint = await this.load({ instanceId: instanceEntry.name, runId: runEntry.name });
          if (!checkpoint) continue;
          entries.push(Object.freeze({
            instanceId: instanceEntry.name,
            runId: runEntry.name,
            version: checkpoint.version,
            definitionRevision: descriptor.definition.revision,
            definitionDigest: descriptor.definition.digest,
            profileKind: checkpoint.profile.kind,
          }));
        }
      }
    }
    entries.sort(compareIndexEntries);
    const projection: FlowRunIndexProjection = Object.freeze({
      schemaVersion: 'depa.flow-run-index/v1',
      entries: Object.freeze(entries),
    });
    await this.#writeRunIndex(projection);
    return projection;
  }

  async readLegacyImportReceipt(
    key: FlowRunCheckpointKey,
  ): Promise<LegacyWorkCtrlImportReceipt | undefined> {
    const locations = this.#locations(key);
    this.#preflightExistingRunBoundary(locations);
    if (!fs.existsSync(locations.runDir)) return undefined;
    const receiptFile = containedPath(locations.runDir, LEGACY_IMPORT_RECEIPT_FILE);
    const checkpoint = await this.load(key);
    if (!fs.existsSync(receiptFile)) return undefined;
    if (!checkpoint) {
      throw new LegacyWorkCtrlImportError(
        'legacy-work-ctrl-receipt-without-checkpoint',
        'A legacy import receipt cannot exist without canonical checkpoint authority.',
      );
    }
    const receipt = readLegacyImportReceiptFile(receiptFile, this.#realStoreRoot);
    assertReceiptMatchesCheckpoint(receipt, checkpoint);
    return receipt;
  }

  async recordLegacyImportReceipt(
    key: FlowRunCheckpointKey,
    value: LegacyWorkCtrlImportReceipt,
  ): Promise<LegacyWorkCtrlImportReceipt> {
    const receipt = normalizeLegacyWorkCtrlImportReceipt(value);
    if (receipt.target.instanceId !== key.instanceId || receipt.target.runId !== key.runId) {
      throw new LegacyWorkCtrlImportConflictError('Receipt target differs from the requested canonical run.');
    }
    const locations = this.#locations(key);
    this.#preflightExistingRunBoundary(locations);
    const lock = await acquireLock(locations.runDir, locations.lockFile, this.#realStoreRoot);
    try {
      this.#assertRunPhysicalBoundary(locations);
      const checkpoint = fs.existsSync(locations.checkpointFile)
        ? this.#readStorage(locations.checkpointFile).checkpoint
        : undefined;
      if (!checkpoint) {
        throw new LegacyWorkCtrlImportError(
          'legacy-work-ctrl-checkpoint-missing',
          'Completion cannot be recorded before canonical checkpoint acceptance.',
        );
      }
      const descriptor = this.#requireInstance(locations.instanceDir, key.instanceId);
      this.#assertCheckpointIdentity(checkpoint, key, descriptor.definition);
      assertReceiptMatchesCheckpoint(receipt, checkpoint);
      const receiptFile = containedPath(locations.runDir, LEGACY_IMPORT_RECEIPT_FILE);
      const stagingFile = containedPath(locations.runDir, LEGACY_IMPORT_RECEIPT_STAGING_FILE);
      if (fs.existsSync(receiptFile)) {
        const existing = readLegacyImportReceiptFile(receiptFile, this.#realStoreRoot);
        if (stableJson(existing) !== stableJson(receipt)) {
          throw new LegacyWorkCtrlImportConflictError('An append-only legacy import receipt already records different facts.');
        }
        return existing;
      }
      if (checkpoint.version !== receipt.acceptedCheckpointVersion
        || digestStableValue(checkpoint) !== receipt.acceptedCheckpointDigest) {
        throw new LegacyWorkCtrlImportConflictError(
          'Receipt recovery without an existing marker requires the exact accepted checkpoint version.',
        );
      }
      removeUncommittedStaging(stagingFile, locations.runDir, this.#realStoreRoot);
      writeBytesNoFollow(stagingFile, stableJson(receipt));
      const staged = readLegacyImportReceiptFile(stagingFile, this.#realStoreRoot);
      if (stableJson(staged) !== stableJson(receipt)) {
        throw new FlowRunFilesystemStoreError(
          'legacy-work-ctrl-receipt-readback-mismatch',
          'Legacy import receipt staging readback differs.',
        );
      }
      this.#assertRunPhysicalBoundary(locations);
      assertRegularFile(stagingFile, this.#realStoreRoot, 'legacy-work-ctrl-receipt-invalid');
      fs.renameSync(stagingFile, receiptFile);
      const accepted = readLegacyImportReceiptFile(receiptFile, this.#realStoreRoot);
      if (stableJson(accepted) !== stableJson(receipt)) {
        throw new FlowRunFilesystemStoreError(
          'legacy-work-ctrl-receipt-readback-mismatch',
          'Accepted legacy import receipt differs.',
        );
      }
      return accepted;
    } finally {
      releaseLock(lock, locations.runDir, this.#realStoreRoot);
    }
  }

  #locations(key: FlowRunCheckpointKey): FlowRunFilesystemLocations {
    assertSafeSegment(key.instanceId);
    assertSafeSegment(key.runId);
    const instancesDir = containedPath(this.#storeRoot, 'instances');
    const instanceDir = containedPath(instancesDir, key.instanceId);
    const runsDir = containedPath(instanceDir, 'runs');
    const runDir = containedPath(runsDir, key.runId);
    return {
      instancesDir,
      instanceDir,
      runsDir,
      runDir,
      checkpointFile: containedPath(runDir, CHECKPOINT_FILE),
      stagingFile: containedPath(runDir, CHECKPOINT_STAGING_FILE),
      lockFile: containedPath(runDir, CHECKPOINT_LOCK_FILE),
    };
  }

  #requireInstance(instanceDir: string, expectedInstanceId: string) {
    const instancesDir = path.dirname(instanceDir);
    assertExistingDirectory(instancesDir, this.#realStoreRoot, 'flow-run-instance-boundary-invalid');
    assertExistingDirectory(instanceDir, this.#realStoreRoot, 'flow-run-instance-boundary-invalid');
    try {
      // Product schema was checked during atomic admission. The canonical store
      // rechecks descriptor, containment and digest without assuming a profile.
      const instance = loadMaterializedFlowInstance(instanceDir, expectedInstanceId, () => undefined);
      return normalizeFlowInstanceDescriptor(instance.descriptor);
    } catch (error) {
      if (error instanceof FlowRunFilesystemStoreError) throw error;
      throw new FlowRunFilesystemStoreError(
        'flow-run-instance-invalid',
        `Frozen instance verification failed: ${(error as Error).message}`,
      );
    }
  }

  #preflightExistingRunBoundary(locations: FlowRunFilesystemLocations): void {
    assertExistingDirectory(locations.instancesDir, this.#realStoreRoot, 'flow-run-instance-boundary-invalid');
    assertExistingDirectory(locations.instanceDir, this.#realStoreRoot, 'flow-run-instance-boundary-invalid');
    if (!fs.existsSync(locations.runsDir)) return;
    assertExistingDirectory(locations.runsDir, this.#realStoreRoot, 'flow-run-boundary-invalid');
    if (!fs.existsSync(locations.runDir)) return;
    assertExistingDirectory(locations.runDir, this.#realStoreRoot, 'flow-run-symlink-boundary');
  }

  #assertCheckpointIdentity(
    checkpoint: AIWorkflowFlowRunCheckpoint,
    key: FlowRunCheckpointKey,
    definition: AIWorkflowFlowRunCheckpoint['definition'],
  ): void {
    if (checkpoint.instanceId !== key.instanceId || checkpoint.runId !== key.runId) {
      throw new FlowRunFilesystemStoreError(
        'flow-run-checkpoint-identity-mismatch',
        'Checkpoint identity differs from its canonical instance/run location.',
      );
    }
    if (stableJson(checkpoint.definition) !== stableJson(definition)) {
      throw new FlowRunFilesystemStoreError(
        'flow-run-definition-mismatch',
        'Checkpoint definition identity differs from the frozen instance.',
      );
    }
  }

  #validateFrozenProfile(checkpoint: AIWorkflowFlowRunCheckpoint) {
    return validateCheckpointAgainstFrozenProfile(checkpoint, {
      ...(this.#profileAuthority === undefined ? {} : { profileAuthority: this.#profileAuthority }),
      extensionCodecs: this.#extensionCodecs,
    }, { requireAIDataAuthority: true });
  }

  #readStorage(file: string) {
    return readCheckpointStorage(file, this.#realStoreRoot, {
      profileAuthority: this.#profileAuthority,
      extensionCodecs: this.#extensionCodecs,
    });
  }

  #ensureRunDirectory(locations: FlowRunFilesystemLocations): void {
    ensureChildDirectory(locations.instanceDir, locations.runsDir, this.#realStoreRoot, this.#durability, 'head');
    ensureChildDirectory(locations.runsDir, locations.runDir, this.#realStoreRoot, this.#durability, 'head');
    this.#assertRunPhysicalBoundary(locations);
  }

  #assertRunPhysicalBoundary(locations: FlowRunFilesystemLocations): void {
    assertExistingDirectory(locations.instanceDir, this.#realStoreRoot, 'flow-run-instance-boundary-invalid');
    assertExistingDirectory(locations.runsDir, this.#realStoreRoot, 'flow-run-boundary-invalid');
    assertExistingDirectory(locations.runDir, this.#realStoreRoot, 'flow-run-symlink-boundary');
  }

  async #writeRunIndex(projection: FlowRunIndexProjection): Promise<void> {
    const indexFile = containedPath(this.#storeRoot, RUN_INDEX_FILE);
    const stagingFile = containedPath(this.#storeRoot, RUN_INDEX_STAGING_FILE);
    const lockFile = containedPath(this.#storeRoot, RUN_INDEX_LOCK_FILE);
    const lock = await acquireLock(this.#storeRoot, lockFile, this.#realStoreRoot);
    try {
      removeUncommittedStaging(stagingFile, this.#storeRoot, this.#realStoreRoot);
      writeBytesNoFollow(stagingFile, stableJson(projection));
      const readback = readJsonFile(stagingFile, this.#realStoreRoot, 'flow-run-index-invalid');
      if (stableJson(readback) !== stableJson(projection)) {
        throw new FlowRunFilesystemStoreError('flow-run-index-readback-mismatch', 'Run index readback differs.');
      }
      assertExistingDirectory(this.#storeRoot, this.#realStoreRoot, 'flow-run-store-root-invalid');
      assertRegularFile(stagingFile, this.#realStoreRoot, 'flow-run-index-invalid');
      if (fs.existsSync(indexFile)) assertRegularFile(indexFile, this.#realStoreRoot, 'flow-run-index-invalid');
      fs.renameSync(stagingFile, indexFile);
      const accepted = readJsonFile(indexFile, this.#realStoreRoot, 'flow-run-index-invalid');
      if (stableJson(accepted) !== stableJson(projection)) {
        throw new FlowRunFilesystemStoreError('flow-run-index-readback-mismatch', 'Accepted run index differs.');
      }
    } finally {
      releaseLock(lock, this.#storeRoot, this.#realStoreRoot);
    }
  }
}

/** Explicit read-only adapter for the existing FileWorkCtrlFlowStore layout. */
export class FilesystemLegacyWorkCtrlSnapshotReader implements LegacyWorkCtrlSnapshotReader {
  readonly #legacyRoot: string;
  readonly #realLegacyRoot: string;

  constructor(options: { readonly legacyRoot: string }) {
    this.#legacyRoot = path.resolve(options.legacyRoot);
    assertExistingDirectory(this.#legacyRoot, undefined, 'legacy-work-ctrl-root-invalid');
    this.#realLegacyRoot = fs.realpathSync(this.#legacyRoot);
  }

  async read(treeId: string): Promise<LegacyWorkCtrlSnapshotRead | undefined> {
    if (typeof treeId !== 'string' || treeId.length === 0 || treeId !== treeId.trim()) {
      throw new LegacyWorkCtrlImportError('legacy-work-ctrl-id-invalid', 'Legacy tree identity must be canonical.');
    }
    let encoded: string;
    try {
      encoded = encodeURIComponent(treeId);
    } catch {
      throw new LegacyWorkCtrlImportError('legacy-work-ctrl-id-invalid', 'Legacy tree identity cannot be encoded safely.');
    }
    const file = containedPath(this.#legacyRoot, `${encoded}.snapshot.json`);
    if (!fs.existsSync(file)) return undefined;
    const bytes = readFileBytesNoFollow(file, this.#realLegacyRoot, 'legacy-work-ctrl-snapshot-invalid');
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch (error) {
      throw new LegacyWorkCtrlImportError(
        'legacy-work-ctrl-snapshot-invalid',
        `Legacy snapshot decode failed: ${(error as Error).message}`,
      );
    }
    if (!isPlainRecord(value)
      || value.schemaVersion !== 'depa.flows.workflow/v4'
      || value.treeId !== treeId) {
      throw new LegacyWorkCtrlImportError(
        'legacy-work-ctrl-identity-mismatch',
        'Legacy snapshot identity or schema differs from its requested flat-store identity.',
      );
    }
    return Object.freeze({
      identity: Object.freeze({ treeId, digest: digestBytes(bytes) }),
      snapshot: value as unknown as WorkCtrlFlowSnapshot,
    });
  }
}

/** Pure legacy snapshot projection; it performs no read, write or completion action. */
export function convertLegacyWorkCtrlSnapshotToCheckpoint(
  snapshot: WorkCtrlFlowSnapshot,
  options: LegacyWorkCtrlCheckpointConversionOptions,
): AIWorkflowFlowRunCheckpoint {
  const closedSnapshot = normalizeFlowClosedObject(snapshot, 'legacy.snapshot') as unknown as WorkCtrlFlowSnapshot;
  assertLegacyWorkCtrlSnapshotShape(closedSnapshot);
  const legacyTreeId = closedSnapshot.treeId;
  const rebindHandle = (handle: WorkCtrlFlowSnapshot['openWaitHandles'][number]) => ({
    ...handle,
    treeId: options.target.runId,
    waitHandleId: rebindLegacyOwnedIdentity(handle.waitHandleId, legacyTreeId, options.target.runId),
  });
  const canonicalSnapshot = Object.freeze({
    ...closedSnapshot,
    treeId: options.target.runId,
    openWaitHandles: closedSnapshot.openWaitHandles.map(rebindHandle),
    closedWaitHandles: closedSnapshot.closedWaitHandles.map(rebindHandle),
    appliedResumeSignals: closedSnapshot.appliedResumeSignals.map((identity) => (
      rebindLegacyOwnedIdentity(identity, legacyTreeId, options.target.runId)
    )),
    orchestration: {
      ...closedSnapshot.orchestration,
      composites: Object.fromEntries(Object.entries(closedSnapshot.orchestration.composites).map(([key, fact]) => [
        key,
        {
          ...fact,
          ...(fact.childTreeId === undefined ? {} : {
            childTreeId: rebindLegacyOwnedIdentity(fact.childTreeId, legacyTreeId, options.target.runId),
          }),
        },
      ])),
    },
  }) as WorkCtrlFlowSnapshot;
  const controllerSidecars = {
    status: canonicalSnapshot.status,
    lastTickNo: canonicalSnapshot.lastTickNo,
    branchDecisions: canonicalSnapshot.branchDecisions,
    orchestration: canonicalSnapshot.orchestration,
    openWaitHandles: canonicalSnapshot.openWaitHandles,
    closedWaitHandles: canonicalSnapshot.closedWaitHandles,
    appliedResumeSignals: canonicalSnapshot.appliedResumeSignals,
  };
  const nodeSidecars = {
    nodeResults: canonicalSnapshot.nodeResults,
    waitResults: canonicalSnapshot.waitResults,
  };
  return normalizeFlowRunCheckpoint({
    schemaVersion: 'depa.flow-run-checkpoint/v1',
    instanceId: options.target.instanceId,
    runId: options.target.runId,
    definition: options.definition,
    version: 0,
    input: canonicalSnapshot.input,
    config: options.config,
    state: canonicalSnapshot.vars,
    output: options.output ?? legacySnapshotOutput(canonicalSnapshot),
    controllerSidecars: controllerSidecars as unknown as FlowClosedObject,
    nodeSidecars: nodeSidecars as unknown as FlowClosedObject,
    profile: {
      kind: 'WorkCtrlFlow',
      snapshot: canonicalSnapshot as unknown as FlowClosedObject,
    },
  });
}

function rebindLegacyOwnedIdentity(value: string, legacyTreeId: string, targetRunId: string): string {
  if (value === legacyTreeId) return targetRunId;
  if (value.startsWith(`${legacyTreeId}:`)) return `${targetRunId}${value.slice(legacyTreeId.length)}`;
  const legacyWaitPrefix = `wh_${legacyTreeId}_`;
  if (value.startsWith(legacyWaitPrefix)) return `wh_${targetRunId}_${value.slice(legacyWaitPrefix.length)}`;
  return value;
}

function assertLegacyWorkCtrlSnapshotShape(snapshot: WorkCtrlFlowSnapshot): void {
  if (snapshot.schemaVersion !== 'depa.flows.workflow/v4'
    || typeof snapshot.treeId !== 'string'
    || snapshot.treeId.length === 0
    || snapshot.treeId !== snapshot.treeId.trim()
    || typeof snapshot.fqn !== 'string'
    || snapshot.fqn.length === 0
    || snapshot.fqn !== snapshot.fqn.trim()
    || (snapshot.status !== 'Waiting' && snapshot.status !== 'Completed' && snapshot.status !== 'Failed')) {
    throw new LegacyWorkCtrlImportError(
      'legacy-work-ctrl-snapshot-invalid',
      'Legacy snapshot schema, identity, FQN or status is invalid.',
    );
  }
}

/** Runtime-first one-way import. Canonical checkpoints are never projected back to legacy files. */
export async function importLegacyWorkCtrlSnapshot(
  runtime: LegacyWorkCtrlImportRuntime,
  input: ImportLegacyWorkCtrlSnapshotInput,
): Promise<LegacyWorkCtrlImportReceipt> {
  const legacy = await runtime.legacyReader.read(input.legacyTreeId);
  if (!legacy) {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-snapshot-missing', 'Legacy flat snapshot does not exist.');
  }
  const candidate = convertLegacyWorkCtrlSnapshotToCheckpoint(legacy.snapshot, input);
  const receipt = normalizeLegacyWorkCtrlImportReceipt({
    schemaVersion: 'depa.flow-legacy-import-receipt/v1',
    legacyTreeId: input.legacyTreeId,
    legacySnapshotDigest: legacy.identity.digest,
    target: input.target,
    definitionRevision: candidate.definition.revision,
    definitionDigest: candidate.definition.digest,
    acceptedCheckpointVersion: 0,
    acceptedCheckpointDigest: digestStableValue(candidate),
  });
  const completed = await runtime.checkpointStore.readLegacyImportReceipt(input.target);
  if (completed) {
    if (stableJson(completed) !== stableJson(receipt)) {
      throw new LegacyWorkCtrlImportConflictError('Existing completion receipt differs from this legacy import.');
    }
    return completed;
  }

  let canonical = await runtime.checkpointStore.load(input.target);
  if (!canonical) {
    try {
      canonical = await runtime.checkpointStore.commit({ expectedVersion: null, checkpoint: candidate });
    } catch (error) {
      if (!(error instanceof FlowRunCheckpointVersionConflictError)) throw error;
      canonical = await runtime.checkpointStore.load(input.target);
    }
  }
  if (!canonical || stableJson(canonical) !== stableJson(candidate)) {
    throw new LegacyWorkCtrlImportConflictError(
      'Target run already contains non-equivalent canonical checkpoint facts.',
    );
  }
  return runtime.checkpointStore.recordLegacyImportReceipt(input.target, receipt);
}

function legacySnapshotOutput(snapshot: WorkCtrlFlowSnapshot): FlowClosedValue {
  const execution = Object.getOwnPropertyDescriptor(snapshot.vars, '__flow_execution__');
  if (!execution || !('value' in execution) || !isPlainRecord(execution.value)) return null;
  const output = Object.getOwnPropertyDescriptor(execution.value, 'output');
  return !output || !('value' in output) || output.value === undefined
    ? null
    : output.value as FlowClosedValue;
}

function normalizeLegacyWorkCtrlImportReceipt(value: unknown): LegacyWorkCtrlImportReceipt {
  const record = exactPlainDataRecord(value, [
    'schemaVersion',
    'legacyTreeId',
    'legacySnapshotDigest',
    'target',
    'definitionRevision',
    'definitionDigest',
    'acceptedCheckpointVersion',
    'acceptedCheckpointDigest',
  ], 'legacyReceipt');
  if (record.schemaVersion !== 'depa.flow-legacy-import-receipt/v1') {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', 'Legacy receipt schema is invalid.');
  }
  const legacyTreeId = canonicalReceiptString(record.legacyTreeId, 'legacyTreeId');
  const legacySnapshotDigest = receiptDigest(record.legacySnapshotDigest, 'legacySnapshotDigest');
  const targetRecord = exactPlainDataRecord(record.target, ['instanceId', 'runId'], 'legacyReceipt.target');
  const target = Object.freeze({
    instanceId: canonicalReceiptString(targetRecord.instanceId, 'target.instanceId'),
    runId: canonicalReceiptString(targetRecord.runId, 'target.runId'),
  });
  assertSafeSegment(target.instanceId);
  assertSafeSegment(target.runId);
  const definitionRevision = canonicalReceiptString(record.definitionRevision, 'definitionRevision');
  const definitionDigest = receiptDigest(record.definitionDigest, 'definitionDigest');
  if (record.acceptedCheckpointVersion !== 0) {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', 'Imported checkpoint version must be zero.');
  }
  const acceptedCheckpointDigest = receiptDigest(record.acceptedCheckpointDigest, 'acceptedCheckpointDigest');
  return Object.freeze({
    schemaVersion: 'depa.flow-legacy-import-receipt/v1',
    legacyTreeId,
    legacySnapshotDigest,
    target,
    definitionRevision,
    definitionDigest,
    acceptedCheckpointVersion: 0,
    acceptedCheckpointDigest,
  });
}

function exactPlainDataRecord(
  value: unknown,
  fields: readonly string[],
  location: string,
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', `${location} must be a plain-data object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', `${location} must not contain symbols.`);
  }
  const expected = new Set(fields);
  if (keys.length !== fields.length || keys.some((key) => !expected.has(key as string))) {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', `${location} fields differ from the closed receipt contract.`);
  }
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', `${location}.${field} must be a data property.`);
    }
  }
  return value;
}

function canonicalReceiptString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', `${field} must be canonical.`);
  }
  return value;
}

function receiptDigest(value: unknown, field: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new LegacyWorkCtrlImportError('legacy-work-ctrl-receipt-invalid', `${field} must be a sha256 digest.`);
  }
  return value as `sha256:${string}`;
}

function readLegacyImportReceiptFile(file: string, realRoot: string): LegacyWorkCtrlImportReceipt {
  try {
    return normalizeLegacyWorkCtrlImportReceipt(
      readJsonFile(file, realRoot, 'legacy-work-ctrl-receipt-invalid'),
    );
  } catch (error) {
    if (error instanceof LegacyWorkCtrlImportError || error instanceof FlowRunFilesystemStoreError) throw error;
    throw new LegacyWorkCtrlImportError(
      'legacy-work-ctrl-receipt-invalid',
      `Legacy import receipt is invalid: ${(error as Error).message}`,
    );
  }
}

function assertReceiptMatchesCheckpoint(
  receipt: LegacyWorkCtrlImportReceipt,
  checkpoint: AIWorkflowFlowRunCheckpoint,
): void {
  if (receipt.target.instanceId !== checkpoint.instanceId
    || receipt.target.runId !== checkpoint.runId
    || receipt.definitionRevision !== checkpoint.definition.revision
    || receipt.definitionDigest !== checkpoint.definition.digest
    || checkpoint.version < receipt.acceptedCheckpointVersion) {
    throw new LegacyWorkCtrlImportConflictError('Legacy import receipt conflicts with canonical checkpoint identity.');
  }
}

function readFileBytesNoFollow(file: string, realRoot: string, code: string): Buffer {
  assertRegularFile(file, realRoot, code);
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | NO_FOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new LegacyWorkCtrlImportError(code, 'Legacy snapshot must be a regular file.');
    return fs.readFileSync(fd);
  } catch (error) {
    if (error instanceof LegacyWorkCtrlImportError || error instanceof FlowRunFilesystemStoreError) throw error;
    throw new LegacyWorkCtrlImportError(code, `Legacy snapshot read failed: ${(error as Error).message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function digestBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function digestStableValue(value: unknown): `sha256:${string}` {
  return digestBytes(Buffer.from(stableJson(value), 'utf8'));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeSegment(value: string): void {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 200
    || value !== value.trim()
    || value === '.'
    || value === '..'
    || value.endsWith('.')
    || value.normalize('NFC') !== value
    || /[<>:"|?*\\/\0\u0001-\u001f\u007f]/u.test(value)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value)) {
    throw new FlowRunFilesystemStoreError('flow-run-id-invalid', 'Flow instance and run ids must be safe canonical path segments.');
  }
}

function containedPath(parent: string, segment: string): string {
  const target = path.resolve(parent, segment);
  const relative = path.relative(parent, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FlowRunFilesystemStoreError('flow-run-boundary-invalid', 'Flow run path escapes its canonical parent.');
  }
  return target;
}

function assertExistingDirectory(file: string, realRoot: string | undefined, code: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new FlowRunFilesystemStoreError(code, 'Required filesystem directory does not exist.');
  }
  if (stat.isSymbolicLink()) {
    throw new FlowRunFilesystemStoreError(
      code === 'flow-run-symlink-boundary' ? code : 'flow-run-symlink-boundary',
      'Filesystem boundary must not be a symbolic link.',
    );
  }
  if (!stat.isDirectory()) throw new FlowRunFilesystemStoreError(code, 'Filesystem boundary must be a directory.');
  if (realRoot !== undefined) assertRealContainment(realRoot, file, code);
}

function assertRegularFile(file: string, realRoot: string, code: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new FlowRunFilesystemStoreError(code, 'Required filesystem file does not exist.');
  }
  if (stat.isSymbolicLink()) throw new FlowRunFilesystemStoreError('flow-run-symlink-boundary', 'Filesystem file must not be a symbolic link.');
  if (!stat.isFile()) throw new FlowRunFilesystemStoreError(code, 'Filesystem entry must be a regular file.');
  assertRealContainment(realRoot, file, code);
}

function assertRealContainment(realRoot: string, file: string, code: string): void {
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FlowRunFilesystemStoreError(code, 'Filesystem entry escapes the injected store root.');
  }
}

function ensureChildDirectory(
  parent: string,
  child: string,
  realRoot: string,
  durability?: CheckpointDurabilityRuntime,
  durabilityRole: 'record' | 'tree' | 'receipt' | 'head' = 'record',
): void {
  assertExistingDirectory(parent, realRoot, 'flow-run-boundary-invalid');
  if (fs.existsSync(child)) {
    assertExistingDirectory(child, realRoot, 'flow-run-symlink-boundary');
    return;
  }
  createDirectoryDurably(child, durabilityRole, durability);
  assertExistingDirectory(child, realRoot, 'flow-run-boundary-invalid');
}

function readCheckpointStorage(
  file: string,
  realRoot: string,
  runtime: { readonly profileAuthority?: import('./checkpoint-profile.js').FlowRunProfileAuthorityPort; readonly extensionCodecs: import('flow-step-space-contract').DefinitionStepExtensionCodecRegistryPort },
): {
  readonly checkpoint: AIWorkflowFlowRunCheckpoint;
  readonly tree?: StepMerkleTree;
  readonly materialRecordDigests?: readonly import('flow-step-space-contract').DefinitionStepDigest[];
} {
  const value = readJsonFile(file, realRoot, 'flow-run-checkpoint-invalid');
  try {
    if (isCheckpointHead(value)) {
      assertSidecarDirectories(path.dirname(file), realRoot);
      const loaded = readCheckpointHeadAndLogical(file,{ctrlMembership(head,kind){
        assertSafeSegment(head.instanceId);
        const authority=runtime.profileAuthority?.load({instanceId:head.instanceId,definition:head.definition,profileKind:kind});
        return authority?.definitionInvocationOwners
          ? {definitionStepIds:authority.definitionStepIds,invocationOwners:authority.definitionInvocationOwners}
          : loadFrozenCtrlDefinitionMembership(path.join(realRoot,'instances',head.instanceId,'definition'),kind,runtime.extensionCodecs);
      }});
      return {
        checkpoint: loaded.checkpoint,
        tree: loaded.tree,
        materialRecordDigests: loaded.materialRecordDigests,
      };
    }
    return { checkpoint: normalizeFlowRunCheckpoint(value) };
  } catch (error) {
    throw new FlowRunFilesystemStoreError(
      'flow-run-checkpoint-invalid',
      `Checkpoint does not satisfy the closed contract: ${(error as Error).message}`,
    );
  }
}

function readJsonFile(file: string, realRoot: string, code: string): unknown {
  assertRegularFile(file, realRoot, code);
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | NO_FOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new FlowRunFilesystemStoreError(code, 'Filesystem entry is not a regular file.');
    return JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof FlowRunFilesystemStoreError) throw error;
    throw new FlowRunFilesystemStoreError(code, `Filesystem JSON decode failed: ${(error as Error).message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeCheckpointCandidate(
  file: string,
  checkpoint: FlowRunCheckpointHead,
  realRoot: string,
  durability?: CheckpointDurabilityRuntime,
): void {
  if (fs.existsSync(file)) {
    throw new FlowRunFilesystemStoreError('flow-run-staging-invalid', 'Checkpoint staging file already exists after recovery.');
  }
  assertExistingDirectory(path.dirname(file), realRoot, 'flow-run-boundary-invalid');
  writeDurableCandidate(file, checkpointHeadJson(checkpoint), 'head', durability);
}

function ensureSidecarDirectories(
  runDir: string,
  realRoot: string,
  durability?: CheckpointDurabilityRuntime,
): void {
  const sidecar = path.join(runDir, 'step-space');
  ensureChildDirectory(runDir, sidecar, realRoot, durability, 'record');
  ensureChildDirectory(sidecar, path.join(sidecar, 'controls'), realRoot, durability, 'record');
  ensureChildDirectory(sidecar, path.join(sidecar, 'records'), realRoot, durability, 'record');
  ensureChildDirectory(sidecar, path.join(sidecar, 'trees'), realRoot, durability, 'tree');
  ensureChildDirectory(sidecar, path.join(sidecar, 'receipts'), realRoot, durability, 'receipt');
}

function assertSidecarDirectories(runDir: string, realRoot: string): void {
  const sidecar = path.join(runDir, 'step-space');
  assertExistingDirectory(sidecar, realRoot, 'flow-run-sidecar-boundary-invalid');
  assertExistingDirectory(path.join(sidecar, 'controls'), realRoot, 'flow-run-sidecar-boundary-invalid');
  assertExistingDirectory(path.join(sidecar, 'records'), realRoot, 'flow-run-sidecar-boundary-invalid');
  assertExistingDirectory(path.join(sidecar, 'trees'), realRoot, 'flow-run-sidecar-boundary-invalid');
  assertExistingDirectory(path.join(sidecar, 'receipts'), realRoot, 'flow-run-sidecar-boundary-invalid');
}

function removeUnacceptedSidecarReceipt(runDir: string, version: number, realRoot: string): void {
  const file = path.join(runDir, 'step-space', 'receipts', `${version}.json`);
  if (!fs.existsSync(file)) return;
  assertRegularFile(file, realRoot, 'flow-run-sidecar-receipt-invalid');
  fs.unlinkSync(file);
}

function writeBytesNoFollow(file: string, bytes: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | NO_FOLLOW,
      0o600,
    );
    fs.writeFileSync(fd, bytes, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function removeUncommittedStaging(file: string, parent: string, realRoot: string): void {
  if (!fs.existsSync(file)) return;
  assertExistingDirectory(parent, realRoot, 'flow-run-boundary-invalid');
  assertRegularFile(file, realRoot, 'flow-run-staging-invalid');
  fs.unlinkSync(file);
}

async function acquireLock(parent: string, file: string, realRoot: string): Promise<HeldLock> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const recoveryFile = `${file}.recovery`;
  for (;;) {
    assertExistingDirectory(parent, realRoot, 'flow-run-boundary-invalid');
    if (lockRecoveryInProgress(recoveryFile, parent, realRoot)) {
      if (Date.now() >= deadline) {
        throw new FlowRunFilesystemStoreError('flow-run-lock-timeout', 'Timed out waiting for canonical checkpoint lock recovery.');
      }
      await delay(LOCK_RETRY_MS);
      continue;
    }
    try {
      const held = createHeldLock(file);
      // A recovery owner may have established its barrier after our first
      // observation. Never publish an owner across that boundary.
      if (lockRecoveryInProgress(recoveryFile, parent, realRoot)) {
        releaseLock(held, parent, realRoot);
        await delay(LOCK_RETRY_MS);
        continue;
      }
      return held;
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error;
      if (tryClaimAbandonedLock(file, recoveryFile, parent, realRoot)) continue;
      if (Date.now() >= deadline) {
        throw new FlowRunFilesystemStoreError('flow-run-lock-timeout', 'Timed out waiting for the canonical checkpoint lock.');
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

function createHeldLock(file: string): HeldLock {
  const token = randomUUID();
  const fd = fs.openSync(
    file,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | NO_FOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, token, createdAtMs: Date.now() })}\n`, 'utf8');
    fs.fsyncSync(fd);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new FlowRunFilesystemStoreError('flow-run-lock-invalid', 'Canonical lock must be a regular file.');
    return { fd, file, token, device: stat.dev, inode: stat.ino };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function lockRecoveryInProgress(file: string, parent: string, realRoot: string): boolean {
  assertExistingDirectory(parent, realRoot, 'flow-run-boundary-invalid');
  const observed = observeLock(file, parent, realRoot);
  if (!observed) return false;
  if (observed.pid !== undefined && processIsAlive(observed.pid)) return true;
  const age = Date.now() - (observed.createdAtMs ?? observed.mtimeMs);
  if ((observed.pid === undefined || observed.token === undefined) && age <= ABANDONED_INCOMPLETE_LOCK_MS) {
    return true;
  }
  return !tryRecoverAbandonedBarrier(file, observed, parent, realRoot);
}

function tryRecoverAbandonedBarrier(
  file: string,
  observed: LockObservation,
  parent: string,
  realRoot: string,
): boolean {
  const quarantineFile = `${file}.abandoned-${randomUUID()}`;
  try {
    fs.renameSync(file, quarantineFile);
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return true;
    throw error;
  }
  const claimed = observeLock(quarantineFile, parent, realRoot);
  if (!claimed) return true;
  if (sameLockIdentity(claimed, observed)) {
    fs.unlinkSync(quarantineFile);
    return true;
  }

  // The observed barrier was replaced between observation and rename. Restore
  // the replacement by an O_EXCL hard link; never unlink its canonical path.
  try {
    fs.linkSync(quarantineFile, file);
  } catch (error) {
    if (!isErrorCode(error, 'EEXIST')) throw error;
  }
  const stillQuarantined = observeLock(quarantineFile, parent, realRoot);
  if (stillQuarantined && sameLockIdentity(stillQuarantined, claimed)) fs.unlinkSync(quarantineFile);
  return false;
}

function tryClaimAbandonedLock(
  file: string,
  recoveryFile: string,
  parent: string,
  realRoot: string,
): boolean {
  assertExistingDirectory(parent, realRoot, 'flow-run-boundary-invalid');
  const observed = observeLock(file, parent, realRoot);
  if (!observed) return true;
  if (observed.pid !== undefined && processIsAlive(observed.pid)) return false;
  if (observed.pid === undefined && Date.now() - observed.mtimeMs <= ABANDONED_INCOMPLETE_LOCK_MS) return false;

  let recovery: HeldLock;
  try {
    recovery = createHeldLock(recoveryFile);
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) return false;
    throw error;
  }
  const quarantineFile = `${file}.abandoned-${recovery.token}`;
  try {
    const current = observeLock(file, parent, realRoot);
    if (!current) return true;
    if (!sameLockIdentity(current, observed)) return false;
    if (!heldLockStillOwnsPath(recovery, parent, realRoot)) return false;
    fs.renameSync(file, quarantineFile);
    const claimed = observeLock(quarantineFile, parent, realRoot);
    if (!claimed || !sameLockIdentity(claimed, observed)) {
      throw new FlowRunFilesystemStoreError(
        'flow-run-lock-claim-invalid',
        'Abandoned lock atomic claim did not preserve the observed owner identity.',
      );
    }
    fs.unlinkSync(quarantineFile);
    return true;
  } finally {
    releaseLock(recovery, parent, realRoot);
  }
}

function observeLock(file: string, parent: string, realRoot: string): LockObservation | undefined {
  assertExistingDirectory(parent, realRoot, 'flow-run-boundary-invalid');
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return undefined;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new FlowRunFilesystemStoreError('flow-run-lock-invalid', 'Canonical lock must be a regular file.');
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown;
    } catch {
      value = undefined;
    }
    const record = typeof value === 'object' && value !== null
      ? value as { readonly pid?: unknown; readonly token?: unknown; readonly createdAtMs?: unknown }
      : undefined;
    return {
      device: stat.dev,
      inode: stat.ino,
      mtimeMs: stat.mtimeMs,
      pid: record && Number.isSafeInteger(record.pid) && (record.pid as number) > 0
        ? record.pid as number
        : undefined,
      token: record && typeof record.token === 'string' && record.token.length > 0
        ? record.token
        : undefined,
      createdAtMs: record && Number.isSafeInteger(record.createdAtMs) && (record.createdAtMs as number) >= 0
        ? record.createdAtMs as number
        : undefined,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function sameLockIdentity(left: LockObservation, right: LockObservation): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.token === right.token;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorCode(error, 'EPERM');
  }
}

function heldLockStillOwnsPath(lock: HeldLock, parent: string, realRoot: string): boolean {
  const current = observeLock(lock.file, parent, realRoot);
  return current !== undefined
    && current.device === lock.device
    && current.inode === lock.inode
    && current.token === lock.token;
}

function releaseLock(lock: HeldLock, parent: string, realRoot: string): void {
  fs.closeSync(lock.fd);
  if (!heldLockStillOwnsPath(lock, parent, realRoot)) return;
  fs.unlinkSync(lock.file);
}

function readDirectoryCodeUnitOrdered(directory: string): fs.Dirent[] {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
}

function compareIndexEntries(left: FlowRunIndexEntry, right: FlowRunIndexEntry): number {
  const instance = compareCodeUnits(left.instanceId, right.instanceId);
  return instance === 0 ? compareCodeUnits(left.runId, right.runId) : instance;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
