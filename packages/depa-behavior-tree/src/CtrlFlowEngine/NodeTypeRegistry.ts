/**
 * Node Type Registry
 *
 * Extensible registry for mapping node types to their BehaviorTreeNodeKind
 * and for bidirectional xmlTag <-> nodeType resolution.
 */

import { BehaviorTreeNodeKind } from '../BehaviorTreeCore';

/**
 * Registry entry for a node type.
 */
export interface NodeTypeRegistryEntry {
  /** The BehaviorTreeNodeKind for this node type */
  kind: BehaviorTreeNodeKind;
  /** The XML tag name used for serialization/deserialization */
  xmlTag: string;
}

const kindMap = new Map<string, BehaviorTreeNodeKind>();
const xmlTagToNodeType = new Map<string, string>();
const nodeTypeToXmlTag = new Map<string, string>();

/**
 * Register a node type with its kind and XML tag.
 * If the node type is already registered, it will be overwritten.
 */
export function registerNodeType(
  nodeType: string,
  kind: BehaviorTreeNodeKind,
  xmlTag?: string
): void {
  const tag = xmlTag ?? nodeType;
  kindMap.set(nodeType, kind);
  xmlTagToNodeType.set(tag, nodeType);
  nodeTypeToXmlTag.set(nodeType, tag);
}

/**
 * Resolve the BehaviorTreeNodeKind for a given node type.
 * Returns BehaviorTreeNodeKind.Action as default for unknown types.
 */
export function resolveNodeKind(nodeType: string): BehaviorTreeNodeKind {
  return kindMap.get(nodeType) ?? BehaviorTreeNodeKind.Action;
}

/**
 * Resolve a node type from an XML tag name.
 * Returns the tag itself if no explicit mapping exists (pass-through).
 */
export function resolveNodeTypeFromXmlTag(xmlTag: string): string | null {
  return xmlTagToNodeType.get(xmlTag) ?? null;
}

/**
 * Resolve an XML tag name from a node type.
 * Returns the nodeType string itself if no explicit mapping exists.
 */
export function resolveXmlTagFromNodeType(nodeType: string): string {
  return nodeTypeToXmlTag.get(nodeType) ?? nodeType;
}

/**
 * Check whether a node type is registered.
 */
export function isNodeTypeRegistered(nodeType: string): boolean {
  return kindMap.has(nodeType);
}

// ---------------------------------------------------------------------------
// Pre-register core node types
// ---------------------------------------------------------------------------

// Control nodes
registerNodeType('Sequence', BehaviorTreeNodeKind.Sequence);
registerNodeType('Selector', BehaviorTreeNodeKind.Selector);
registerNodeType('Condition', BehaviorTreeNodeKind.Condition);
registerNodeType('Until', BehaviorTreeNodeKind.Until);

// Condition leaf nodes
registerNodeType('CheckVariable', BehaviorTreeNodeKind.Condition);
registerNodeType('CheckExpression', BehaviorTreeNodeKind.Condition);

// Core action nodes
registerNodeType('SetVariable', BehaviorTreeNodeKind.Action);
registerNodeType('Log', BehaviorTreeNodeKind.Action);
registerNodeType('Assert', BehaviorTreeNodeKind.Action);
registerNodeType('Sleep', BehaviorTreeNodeKind.Action);
registerNodeType('RunScript', BehaviorTreeNodeKind.Action);
registerNodeType('HttpCall', BehaviorTreeNodeKind.Action);
