import type { AIAgentCodeResourceKind, AIAgentCodeResourceProjection, AIWorkflowTypedResourceRef } from 'ai-workflow-contract';
import type { ResourceDependencyEdge, ResourceNode, ResourceRecord, ResourceValue } from 'halfcode-compiler.xnl/resource-core';
import { normalizeFlowClosedObject } from './run-checkpoint.js';

const authenticCodeProjections = new WeakSet<object>();
export function isAuthenticAIAgentCodeProjection(value: AIAgentCodeResourceProjection): boolean {
  return authenticCodeProjections.has(value);
}

/** Pure projection; compiler, filesystem and runtime binding stay in the server entry. */
export function projectAIAgentCodeResources(
  resources: ReadonlyMap<string, ResourceRecord>,
  edges: ResourceDependencyEdge[],
): readonly AIAgentCodeResourceProjection[] {
  return Object.freeze([...resources.values()]
    .filter((resource) => resource.kind === 'AgentContextPipeline' || resource.kind === 'AgentMessageSource')
    .sort((a, b) => a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0)
    .map((resource) => {
      const kind = resource.kind as AIAgentCodeResourceKind;
      const node = resource.node;
      allowed(Object.keys(node.subdomains), ['Content', 'CodeBinding', 'Config', 'Assets', 'DependencyRefs']);
      const version = resource.metadata.specVersion;
      if (version !== 1 && version !== 2) fail(`Unsupported code spec version: ${version}`);
      const contentNode = node.subdomains.Content;
      const bindingNode = node.subdomains.CodeBinding;
      if (contentNode && !bindingNode) {
        if (Object.keys(node.subdomains).some(key => key !== 'Content')) fail('Legacy Content cannot contain native config/dependencies');
        const content = contentNode.text;
        if (contentNode.tag !== 'Content' || typeof content !== 'string' || content.length === 0) fail('Legacy Content must contain non-empty text');
        return mark(Object.freeze({ kind, resource, mode: 'legacy', content, config: Object.freeze({}), assets: Object.freeze({}), dependencies: Object.freeze([]) }));
      }
      if (version !== 2 || !bindingNode || contentNode) fail('Native code requires spec 2 and exactly one CodeBinding');
      leaf(bindingNode, 'CodeBinding', ['packageName', 'module', 'exportName']);
      const packageName = text(bindingNode.properties.packageName, 'packageName');
      const module = text(bindingNode.properties.module, 'module');
      const exportName = text(bindingNode.properties.exportName, 'exportName');
      if (!module.startsWith('./')) fail('CodeBinding.module must be package-relative');
      safePath(module.slice(2));
      if (packageName.startsWith('.') || packageName.startsWith('/') || /[\\\s]/.test(packageName)) fail('Invalid CodeBinding.packageName');
      const binding = Object.freeze({ packageName, module, exportName, moduleSpecifier: `${packageName}/${module.slice(2)}` });
      const configNode = node.subdomains.Config;
      if (configNode) leaf(configNode, 'Config', ['value']);
      const config = normalizeFlowClosedObject(configNode?.properties.value ?? {});
      const assets: Record<string, 'text' | 'json'> = Object.create(null);
      for (const value of list(node.subdomains.Assets, 'Assets')) {
        leaf(value, 'Asset', ['path', 'format']);
        const path = safePath(text(value.properties.path, 'Asset.path'));
        const format = value.properties.format;
        if ((format !== 'text' && format !== 'json') || Object.hasOwn(assets, path)) fail('Invalid or duplicate Asset');
        assets[path] = format;
      }
      const dependencies: AIWorkflowTypedResourceRef[] = [];
      const ids = new Set<string>();
      const targets = new Set<string>();
      for (const value of list(node.subdomains.DependencyRefs, 'DependencyRefs')) {
        leaf(value, 'DependencyRef', ['kind', 'ref']);
        const id = text(value.resourceId, 'DependencyRef.id');
        const ref = text(value.properties.ref, 'DependencyRef.ref');
        const targetKind = text(value.properties.kind, 'DependencyRef.kind');
        if (!ref.startsWith('resource://') || !ref.slice(11) || /\s/.test(ref)) fail('Invalid dependency resource ref');
        const target = resources.get(ref.slice(11));
        if (!target || target.kind !== targetKind || ids.has(id) || targets.has(ref)) fail('Missing, mistyped or duplicate dependency');
        ids.add(id); targets.add(ref);
        dependencies.push(Object.freeze({ kind: targetKind, ref: ref as `resource://${string}`, resource: target }));
        edges.push(Object.freeze({ fromResourceId: resource.resourceId, toResourceId: target.resourceId, relation: 'agent-code-dependency', declaredBy: resource.resourceId }));
      }
      return mark(Object.freeze({ kind, resource, mode: 'native', binding, config, assets: Object.freeze(assets), dependencies: Object.freeze(dependencies) }));
    }));
}

function mark<T extends AIAgentCodeResourceProjection>(value: T): T { authenticCodeProjections.add(value); return value; }
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) fail(`Expected canonical ${label}`);
  return value;
}
function safePath(value: string): string {
  if (value.startsWith('/') || /[\\\0?#]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail('Invalid code-owned path');
  return value;
}
function allowed(actual: readonly string[], expected: readonly string[]): void {
  if (actual.some(key => !expected.includes(key))) fail('Unsupported code recipe field');
}
function leaf(value: ResourceNode, tag: string, properties: readonly string[]): void {
  if (value.tag !== tag || value.body.length || Object.keys(value.subdomains).length || value.text) fail(`Invalid ${tag} node`);
  allowed(Object.keys(value.properties), properties);
}
function list(value: ResourceNode | undefined, tag: string): ResourceNode[] {
  if (!value) return [];
  if (value.tag !== tag || Object.keys(value.properties).length || Object.keys(value.subdomains).length || value.text) fail(`Invalid ${tag} list`);
  return value.body.map(item => {
    if (!isNode(item)) fail(`Expected node in ${tag}`);
    return item;
  });
}
function isNode(value: ResourceValue): value is ResourceNode {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'tag' in value && 'body' in value;
}
function fail(message: string): never { throw new Error(`AI_AGENT_CODE_INVALID: ${message}`); }
