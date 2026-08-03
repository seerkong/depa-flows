import path from 'node:path';
import fs from 'node:fs';
import {
  createFilesystemFlowCodeResolver,
  loadFlowBundle,
} from 'instant-ctrl-flow-logic/filesystem';
import { WorkCtrlFlowEngine, WorkCtrlFlowLoadError, type WorkCtrlFlowEngineOptions } from './engine.js';
import { annotateFlowFile, materializeInstance } from './instance.js';

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
