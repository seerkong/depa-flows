import path from 'node:path';
import fs from 'node:fs';
import {
  createFilesystemFlowCodeResolver,
  loadFlowBundle,
} from 'instant-flow-logic/filesystem';
import { annotateTaskSpaceFile, materializeInstance } from 'work-flow-logic';
import {
  applyOperation,
  findNode,
  findTask,
  isOperable,
  listTasks,
  terminalStatusOf,
} from 'task-manager-logic';
import {
  BizProcessEngine,
  type BizProcessEngineOptions,
  type BizProcessTaskDependencies,
} from './engine.js';

export const defaultBizProcessTaskDependencies: BizProcessTaskDependencies = {
  applyOperation,
  findNode,
  findTask,
  isOperable,
  listTasks,
  terminalStatusOf,
};

export interface BizProcessDirectoryOptions
  extends Omit<BizProcessEngineOptions, 'definition' | 'tasks' | 'view'> {
  bundleDir: string;
  instancesDir?: string;
  tasks?: BizProcessTaskDependencies;
}

export function createBizProcessEngineFromDirectory(options: BizProcessDirectoryOptions): BizProcessEngine {
  const result = loadFlowBundle(options.bundleDir);
  if (!result.spec) throw new Error(result.diagnostics.map((item) => `[${item.code}] ${item.message}`).join('; '));
  return new BizProcessEngine({
    ...options,
    definition: { spec: result.spec, resolveCode: createFilesystemFlowCodeResolver() },
    tasks: options.tasks ?? defaultBizProcessTaskDependencies,
    ...(options.instancesDir
      ? { view: { annotateTasks: (treeId, statuses) => {
          const instanceDir = path.join(options.instancesDir!, treeId);
          if (!fs.existsSync(instanceDir)) materializeInstance(options.bundleDir, instanceDir);
          annotateTaskSpaceFile(instanceDir, { ...statuses });
        } } }
      : {}),
  });
}
