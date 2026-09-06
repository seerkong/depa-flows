import {
  loadResourceTree,
  type LoadResourceTreeOptions,
} from 'halfcode-compiler.xnl/resource-core';
import type { LoadedAIWorkflowResourcePackage } from 'ai-workflow-contract';
import { projectAIWorkflowAppBundles } from './index.js';
import {
  resolveAIWorkflowResourceTree,
  type AIWorkflowResourceResolutionContext,
} from './resource-resolution.js';

export {
  AI_WORKFLOW_RESOURCE_SCHEMA_VALIDATOR,
  DEPA_AI_RESOURCE_READER_PROFILE_ID,
  createAIWorkflowResourceResolutionContext,
  createResolvedAIWorkflowContentIdentityIndex,
  resolveAIWorkflowResourceTree,
} from './resource-resolution.js';
export type { AIWorkflowResourceResolutionContext } from './resource-resolution.js';

export interface LoadAIWorkflowResourcePackageOptions extends LoadResourceTreeOptions {
  readonly resolutionContext?: AIWorkflowResourceResolutionContext;
}

export async function loadAIWorkflowResourcePackage(
  options: LoadAIWorkflowResourcePackageOptions,
): Promise<LoadedAIWorkflowResourcePackage> {
  const { resolutionContext, ...loadOptions } = options;
  const authoredTree = await loadResourceTree(loadOptions);
  const tree = resolveAIWorkflowResourceTree(authoredTree, resolutionContext);
  return Object.freeze({
    authoredTree,
    tree,
    appBundles: projectAIWorkflowAppBundles(tree.registry, {
      packageResourceId: tree.manifest.resourceId,
    }),
  });
}
