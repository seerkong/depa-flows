import path from 'node:path';
import fs from 'node:fs';
import {
  createFilesystemFlowCodeResolver,
  loadFlowBundle,
} from 'instant-ctrl-flow-logic/filesystem';
import { annotateTaskSpaceFile, materializeInstance } from 'work-ctrl-flow-logic';
import {
  applyOperation,
  findNode,
  findTask,
  isOperable,
  listTasks,
  terminalStatusOf,
} from 'task-manager-logic';
import {
  BPCtrlFlowEngine,
  type BPCtrlFlowEngineOptions,
  type BPCtrlFlowTaskDependencies,
} from './engine.js';

export const defaultBPCtrlFlowTaskDependencies: BPCtrlFlowTaskDependencies = {
  applyOperation,
  findNode,
  findTask,
  isOperable,
  listTasks,
  terminalStatusOf,
};

export interface BPCtrlFlowDirectoryOptions
  extends Omit<BPCtrlFlowEngineOptions, 'definition' | 'tasks' | 'view'> {
  bundleDir: string;
  instancesDir?: string;
  tasks?: BPCtrlFlowTaskDependencies;
}

export function createBPCtrlFlowEngineFromDirectory(options: BPCtrlFlowDirectoryOptions): BPCtrlFlowEngine {
  const result = loadFlowBundle(options.bundleDir);
  if (!result.spec) throw new Error(result.diagnostics.map((item) => `[${item.code}] ${item.message}`).join('; '));
  return new BPCtrlFlowEngine({
    ...options,
    definition: { spec: result.spec, resolveCode: createFilesystemFlowCodeResolver() },
    tasks: options.tasks ?? defaultBPCtrlFlowTaskDependencies,
    ...(options.instancesDir
      ? { view: { annotateTasks: (treeId, statuses) => {
          const instanceDir = path.join(options.instancesDir!, treeId);
          if (!fs.existsSync(instanceDir)) materializeInstance(options.bundleDir, instanceDir);
          annotateTaskSpaceFile(instanceDir, { ...statuses });
        } } }
      : {}),
  });
}
