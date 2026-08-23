import {
  loadResourceTree,
  type LoadResourceTreeOptions,
} from 'halfcode-compiler.xnl/resource-core';
import type { LoadedAIWorkflowResourcePackage } from 'ai-workflow-contract';
import { projectAIWorkflowAppBundles } from './index.js';

export async function loadAIWorkflowResourcePackage(
  options: LoadResourceTreeOptions,
): Promise<LoadedAIWorkflowResourcePackage> {
  const tree = await loadResourceTree(options);
  return Object.freeze({
    tree,
    appBundles: projectAIWorkflowAppBundles(tree.registry, {
      packageResourceId: tree.manifest.resourceId,
    }),
  });
}
