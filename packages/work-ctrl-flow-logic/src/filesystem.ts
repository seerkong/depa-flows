import path from 'node:path';
import fs from 'node:fs';
import {
  createFilesystemFlowCodeResolver,
  loadFlowBundle,
} from 'instant-ctrl-flow-logic/filesystem';
import { WorkCtrlFlowEngine, WorkCtrlFlowLoadError, type WorkCtrlFlowEngineOptions } from './engine.js';
import type {
  ResumeSignal,
  TickOutcome,
  WorkCtrlFlowStartOptions,
  WorkCtrlFlowStore,
} from 'work-ctrl-flow-contract';
import {
  annotateFlowFile,
  computeFlowBundleDigest,
  FlowInstanceMaterializationError,
  loadMaterializedFlowInstance,
  materializeFlowInstance,
  materializeInstance,
  readFlowInstanceDescriptor,
  type FlowInstanceSourceIdentity,
} from './instance.js';

export { computeFlowBundleDigest, readFlowInstanceDescriptor } from './instance.js';

export interface WorkCtrlFlowDirectoryOptions
  extends Omit<WorkCtrlFlowEngineOptions, 'definition' | 'view'> {
  bundleDir: string;
  instancesDir?: string;
}

/** Directory convenience only; loading and execution delegate to source/spec core APIs. */
export function createWorkCtrlFlowEngineFromDirectory(options: WorkCtrlFlowDirectoryOptions): WorkCtrlFlowEngine {
  const result = loadFlowBundle(options.bundleDir);
  const hard = result.diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
  if (!result.spec || hard.length) {
    throw new WorkCtrlFlowLoadError(result.diagnostics.map((item) => item.code), result.diagnostics.map((item) => item.message).join('; '));
  }
  return new WorkCtrlFlowEngine({
    ...options,
    definition: { spec: result.spec, resolveCode: createFilesystemFlowCodeResolver() },
    ...(options.instancesDir
      ? { view: { annotateTree: (treeId, view) => {
          const instanceDir = path.join(options.instancesDir!, treeId);
          if (!fs.existsSync(instanceDir)) materializeInstance(options.bundleDir, instanceDir);
          annotateFlowFile(instanceDir, view);
        } } }
      : {}),
  });
}

export interface MaterializedWorkCtrlFlowDirectoryOptions
  extends Omit<WorkCtrlFlowEngineOptions, 'definition'> {
  /** Required only when the bound instance has not been admitted yet. */
  bundleDir?: string;
  instancesDir: string;
  instanceId: string;
  /** Required only for first admission; ignored by fresh recovery of an existing instance. */
  source?: FlowInstanceSourceIdentity;
}

/**
 * Instance-bound engine facade. Every operation builds its delegate solely
 * from the admitted frozen definition; live bundleDir is an admission input.
 */
export class MaterializedWorkCtrlFlowDirectoryEngine {
  readonly store: WorkCtrlFlowStore;

  constructor(private readonly options: MaterializedWorkCtrlFlowDirectoryOptions) {
    this.store = options.store;
  }

  get spec() {
    return this.loadDefinition(this.requireExistingInstance().definitionDir).spec;
  }

  async start(treeId: string, options: WorkCtrlFlowStartOptions = {}): Promise<TickOutcome> {
    const instance = this.ensureInstanceForStart();
    const delegate = this.delegate(instance.definitionDir);
    const existing = await this.store.load(treeId);
    if (existing) {
      if (options.input !== undefined && JSON.stringify(options.input) !== JSON.stringify(existing.input)) {
        throw new WorkCtrlFlowLoadError(['tree-start-input-mismatch'], `tree ${treeId} is already bound to different start input`);
      }
      const outcome = await delegate.getOutcome(treeId);
      if (!outcome) throw new WorkCtrlFlowLoadError(['tree-outcome-missing'], `tree ${treeId} has no durable outcome`);
      return outcome;
    }
    return delegate.start(treeId, options);
  }

  async resume(treeId: string, signal: ResumeSignal): Promise<TickOutcome> {
    return this.delegate(this.requireExistingInstance().definitionDir).resume(treeId, signal);
  }

  async fireDueDeadlines(treeId: string): Promise<TickOutcome> {
    return this.delegate(this.requireExistingInstance().definitionDir).fireDueDeadlines(treeId);
  }

  async fireDueTimers(treeId: string): Promise<TickOutcome> {
    return this.fireDueDeadlines(treeId);
  }

  async refresh(treeId: string): Promise<TickOutcome> {
    return this.delegate(this.requireExistingInstance().definitionDir).refresh(treeId);
  }

  async getOutcome(treeId: string): Promise<TickOutcome | undefined> {
    return this.delegate(this.requireExistingInstance().definitionDir).getOutcome(treeId);
  }

  private ensureInstanceForStart() {
    const instanceDir = this.instanceDir();
    if (fs.existsSync(instanceDir)) {
      return loadMaterializedFlowInstance(instanceDir, this.options.instanceId);
    }
    if (!this.options.bundleDir || !this.options.source) {
      throw new FlowInstanceMaterializationError(
        'instance-admission-source-required',
        'bundleDir and source identity are required to admit a new instance',
      );
    }
    return materializeFlowInstance({
      definitionDir: this.options.bundleDir,
      instancesDir: this.options.instancesDir,
      instanceId: this.options.instanceId,
      source: this.options.source,
      materializedAtMs: this.options.clock?.now(),
    });
  }

  private requireExistingInstance() {
    return loadMaterializedFlowInstance(this.instanceDir(), this.options.instanceId);
  }

  private instanceDir(): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(this.options.instanceId)
      || this.options.instanceId === '.'
      || this.options.instanceId === '..') {
      throw new FlowInstanceMaterializationError('instance-id-invalid', 'instanceId must be one safe path segment');
    }
    const root = path.resolve(this.options.instancesDir);
    const target = path.resolve(root, this.options.instanceId);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new FlowInstanceMaterializationError('instance-containment-invalid', 'instance path escapes instances root');
    }
    return target;
  }

  private delegate(definitionDir: string): WorkCtrlFlowEngine {
    const { bundleDir: _bundleDir, instancesDir: _instancesDir, instanceId: _instanceId, source: _source, ...engineOptions } = this.options;
    const loaded = this.loadDefinition(definitionDir);
    return new WorkCtrlFlowEngine({
      ...engineOptions,
      definition: {
        spec: loaded.spec,
        resolveCode: createFilesystemFlowCodeResolver(),
      },
    });
  }

  private loadDefinition(definitionDir: string) {
    const result = loadFlowBundle(definitionDir);
    const hard = result.diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
    if (!result.spec || hard.length > 0) {
      throw new WorkCtrlFlowLoadError(
        result.diagnostics.map((item) => item.code),
        result.diagnostics.map((item) => item.message).join('; '),
      );
    }
    return { spec: result.spec };
  }
}

export function createMaterializedWorkCtrlFlowEngineFromDirectory(
  options: MaterializedWorkCtrlFlowDirectoryOptions,
): MaterializedWorkCtrlFlowDirectoryEngine {
  return new MaterializedWorkCtrlFlowDirectoryEngine(options);
}
