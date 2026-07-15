import path from 'node:path';
import fs from 'node:fs';
import {
  createFilesystemFlowCodeResolver,
  loadFlowBundle,
} from 'instant-flow-logic/filesystem';
import { WorkFlowEngine, WorkFlowLoadError, type WorkFlowEngineOptions } from './engine.js';
import { annotateFlowFile, materializeInstance } from './instance.js';

export interface WorkFlowDirectoryOptions
  extends Omit<WorkFlowEngineOptions, 'definition' | 'view'> {
  bundleDir: string;
  instancesDir?: string;
}

/** Directory convenience only; loading and execution delegate to source/spec core APIs. */
export function createWorkFlowEngineFromDirectory(options: WorkFlowDirectoryOptions): WorkFlowEngine {
  const result = loadFlowBundle(options.bundleDir);
  const hard = result.diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
  if (!result.spec || hard.length) {
    throw new WorkFlowLoadError(result.diagnostics.map((item) => item.code), result.diagnostics.map((item) => item.message).join('; '));
  }
  return new WorkFlowEngine({
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
