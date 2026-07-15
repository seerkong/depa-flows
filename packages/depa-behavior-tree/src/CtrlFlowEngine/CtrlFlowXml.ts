import { BehaviorTreeNode, INodeConfig } from '../BehaviorTreeCore';
import { CtrlFlowBuilder } from './CtrlFlowBuilder';
import { validateNodeConfig, CtrlFlowSchemaIssue } from './NodeConfigSchema';
import { CtrlFlowNodeType } from './types';
import { resolveNodeTypeFromXmlTag, resolveXmlTagFromNodeType, resolveNodeKind } from './NodeTypeRegistry';
import { BehaviorTreeNodeKind } from '../BehaviorTreeCore';

type CtrlFlowNode = BehaviorTreeNode<CtrlFlowNodeType, INodeConfig>;

interface XmlElementNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlElementNode[];
  textChunks: string[];
}

export interface CtrlFlowXmlIssue extends CtrlFlowSchemaIssue {
  nodeType?: string;
}

export class CtrlFlowXmlAggregateError extends Error {
  readonly issues: CtrlFlowXmlIssue[];

  constructor(issues: CtrlFlowXmlIssue[]) {
    super(
      `CtrlFlow XML contains ${issues.length} issue(s): ` +
      issues.map((issue) => `${issue.path} ${issue.message}`).join(' | ')
    );
    this.name = 'CtrlFlowXmlAggregateError';
    this.issues = issues;
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = attrRegex.exec(raw);
  while (match) {
    const attrName = match[1];
    const quotedValue = match[3] ?? match[4] ?? '';
    attrs[attrName] = decodeXmlEntities(quotedValue);
    match = attrRegex.exec(raw);
  }
  return attrs;
}

function parseXml(xml: string): XmlElementNode {
  const stack: XmlElementNode[] = [];
  let root: XmlElementNode | null = null;
  let i = 0;

  while (i < xml.length) {
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end === -1) {
        throw new Error('Unclosed XML comment.');
      }
      i = end + 3;
      continue;
    }

    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end === -1) {
        throw new Error('Unclosed XML declaration.');
      }
      i = end + 2;
      continue;
    }

    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end === -1) {
        throw new Error('Unclosed CDATA section.');
      }
      const cdataContent = xml.slice(i + 9, end);
      if (stack.length > 0) {
        stack[stack.length - 1].textChunks.push(cdataContent);
      }
      i = end + 3;
      continue;
    }

    if (xml[i] === '<') {
      if (xml[i + 1] === '/') {
        const end = xml.indexOf('>', i + 2);
        if (end === -1) {
          throw new Error('Unclosed closing tag.');
        }

        const closingName = xml.slice(i + 2, end).trim();
        const current = stack.pop();
        if (!current) {
          throw new Error(`Unexpected closing tag </${closingName}>.`);
        }
        if (current.name !== closingName) {
          throw new Error(`Mismatched closing tag: expected </${current.name}> but got </${closingName}>.`);
        }
        i = end + 1;
        continue;
      }

      let end = i + 1;
      let quote: '"' | "'" | null = null;
      while (end < xml.length) {
        const ch = xml[end];
        if (quote) {
          if (ch === quote) {
            quote = null;
          }
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '>') {
          break;
        }
        end += 1;
      }

      if (end >= xml.length) {
        throw new Error('Unclosed opening tag.');
      }

      let tagContent = xml.slice(i + 1, end).trim();
      const selfClosing = tagContent.endsWith('/');
      if (selfClosing) {
        tagContent = tagContent.slice(0, -1).trim();
      }

      const firstSpace = tagContent.search(/\s/);
      const tagName = firstSpace === -1 ? tagContent : tagContent.slice(0, firstSpace);
      const attrSegment = firstSpace === -1 ? '' : tagContent.slice(firstSpace + 1);
      if (!tagName) {
        throw new Error('Invalid empty tag name.');
      }

      const element: XmlElementNode = {
        name: tagName,
        attrs: parseAttributes(attrSegment),
        children: [],
        textChunks: [],
      };

      if (!root) {
        root = element;
      }

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(element);
      }

      if (!selfClosing) {
        stack.push(element);
      }

      i = end + 1;
      continue;
    }

    const nextTag = xml.indexOf('<', i);
    const text = (nextTag === -1 ? xml.slice(i) : xml.slice(i, nextTag));
    if (stack.length > 0 && text.length > 0) {
      stack[stack.length - 1].textChunks.push(decodeXmlEntities(text));
    }
    i = nextTag === -1 ? xml.length : nextTag;
  }

  if (stack.length > 0) {
    throw new Error(`Unclosed tag <${stack[stack.length - 1].name}>.`);
  }

  if (!root) {
    throw new Error('XML document has no root node.');
  }

  return root;
}

/**
 * Resolve node type from XML tag name via registry.
 */
function toNodeType(tagName: string): CtrlFlowNodeType | null {
  return resolveNodeTypeFromXmlTag(tagName);
}

function parseConfigNode(
  element: XmlElementNode,
  path: string,
  issues: CtrlFlowXmlIssue[]
): INodeConfig {
  const configNodes = element.children.filter((child) => child.name === 'Config');
  if (configNodes.length > 1) {
    issues.push({
      code: 'DUPLICATE_CONFIG_NODE',
      path: `${path}/Config`,
      message: 'Multiple Config nodes are not allowed.',
    });
  }

  if (configNodes.length === 0) {
    return {};
  }

  const raw = configNodes[0].textChunks.join('').trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as INodeConfig;
  } catch (error) {
    issues.push({
      code: 'INVALID_CONFIG_JSON',
      path: `${path}/Config`,
      message: `Config JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
    });
    return {};
  }
}

function parseSubNodes(
  element: XmlElementNode,
  path: string,
  issues: CtrlFlowXmlIssue[]
): CtrlFlowNode[] {
  const subNodesContainers = element.children.filter((child) => child.name === 'SubNodes');
  if (subNodesContainers.length > 1) {
    issues.push({
      code: 'DUPLICATE_SUBNODES_NODE',
      path: `${path}/SubNodes`,
      message: 'Multiple SubNodes nodes are not allowed.',
    });
  }

  if (subNodesContainers.length === 0) {
    return [];
  }

  const subNodesContainer = subNodesContainers[0];
  const parsedNodes: CtrlFlowNode[] = [];
  subNodesContainer.children.forEach((child, index) => {
    const childPath = `${path}/SubNodes/${child.name}[${index}]`;
    const parsed = parseElementToCtrlFlowNode(child, childPath, issues);
    if (parsed) {
      parsedNodes.push(parsed);
    }
  });

  return parsedNodes;
}

function parseElementToCtrlFlowNode(
  element: XmlElementNode,
  path: string,
  issues: CtrlFlowXmlIssue[]
): CtrlFlowNode | null {
  const nodeType = toNodeType(element.name);
  if (!nodeType) {
    issues.push({
      code: 'UNKNOWN_NODE_TYPE',
      path,
      message: `Unknown node type tag: ${element.name}`,
      nodeType: element.name,
    });
    return null;
  }

  const expectedKnownChildren = new Set(['Config', 'SubNodes']);
  element.children.forEach((child) => {
    if (!expectedKnownChildren.has(child.name)) {
      issues.push({
        code: 'UNKNOWN_CHILD_ELEMENT',
        path: `${path}/${child.name}`,
        message: `Unexpected child element ${child.name}.`,
        nodeType,
      });
    }
  });

  const config = parseConfigNode(element, path, issues);
  const configIssues = validateNodeConfig(nodeType, config, `${path}.config`);
  configIssues.forEach((issue) => {
    issues.push({ ...issue, nodeType });
  });

  const subNodes = parseSubNodes(element, path, issues);

  const hasKey = Object.prototype.hasOwnProperty.call(element.attrs, 'key');
  const hasName = Object.prototype.hasOwnProperty.call(element.attrs, 'name');
  const meta = hasKey || hasName
    ? {
      ...(hasKey ? { key: element.attrs.key } : {}),
      ...(hasName ? { name: element.attrs.name } : {}),
    }
    : undefined;

  if (configIssues.length > 0) {
    return null;
  }

  try {
    return CtrlFlowBuilder.node(nodeType, meta, config, subNodes);
  } catch (error) {
    issues.push({
      code: 'NODE_BUILD_ERROR',
      path,
      message: error instanceof Error ? error.message : String(error),
      nodeType,
    });
    return null;
  }
}

export function loadCtrlFlowFromXml(xml: string): CtrlFlowNode {
  const issues: CtrlFlowXmlIssue[] = [];

  let rootElement: XmlElementNode;
  try {
    rootElement = parseXml(xml);
  } catch (error) {
    issues.push({
      code: 'XML_PARSE_ERROR',
      path: '/xml',
      message: error instanceof Error ? error.message : String(error),
    });
    throw new CtrlFlowXmlAggregateError(issues);
  }

  const rootPath = `/${rootElement.name}`;
  const rootNode = parseElementToCtrlFlowNode(rootElement, rootPath, issues);

  if (!rootNode) {
    issues.push({
      code: 'ROOT_NODE_INVALID',
      path: rootPath,
      message: 'Root node cannot be materialized.',
    });
  }

  if (issues.length > 0 || !rootNode) {
    throw new CtrlFlowXmlAggregateError(issues);
  }

  return rootNode;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tagNameFromNode(node: CtrlFlowNode): string {
  const kind = resolveNodeKind(node.Type as string);
  switch (kind) {
    case BehaviorTreeNodeKind.Sequence:
    case BehaviorTreeNodeKind.Selector:
    case BehaviorTreeNodeKind.Condition:
    case BehaviorTreeNodeKind.Until:
      // For control nodes, use the registry tag or fall back to Kind
      return resolveXmlTagFromNodeType(node.Type as string);
    default:
      return resolveXmlTagFromNodeType(node.Type as string);
  }
}

function hasSerializableConfig(config: INodeConfig | undefined): boolean {
  if (config === undefined || config === null) {
    return false;
  }

  if (Array.isArray(config)) {
    return config.length > 0;
  }

  if (typeof config !== 'object') {
    return true;
  }

  return Object.keys(config).length > 0;
}

function prettifyConfig(config: INodeConfig): string {
  return JSON.stringify(config, null, 2);
}

function serializeNode(node: CtrlFlowNode, depth: number, indent: string): string {
  const pad = indent.repeat(depth);
  const childPad = indent.repeat(depth + 1);
  const configPad = indent.repeat(depth + 2);

  const tagName = tagNameFromNode(node);
  const attrs: string[] = [];
  if (node.Attr && Object.prototype.hasOwnProperty.call(node.Attr, 'key') && node.Attr.key !== undefined) {
    attrs.push(`key="${escapeAttr(node.Attr.key)}"`);
  }
  if (node.Attr && Object.prototype.hasOwnProperty.call(node.Attr, 'name') && node.Attr.name !== undefined) {
    attrs.push(`name="${escapeAttr(node.Attr.name)}"`);
  }

  const openTag = attrs.length > 0 ? `<${tagName} ${attrs.join(' ')}>` : `<${tagName}>`;
  const includeConfig = hasSerializableConfig(node.Config);

  const lines: string[] = [];
  lines.push(`${pad}${openTag}`);
  if (includeConfig) {
    const configJson = prettifyConfig(node.Config as INodeConfig);
    lines.push(`${childPad}<Config><![CDATA[`);
    configJson.split('\n').forEach((line) => {
      lines.push(`${configPad}${line}`);
    });
    lines.push(`${childPad}]]></Config>`);
  }

  if (node.Children.length > 0) {
    lines.push(`${childPad}<SubNodes>`);
    node.Children.forEach((child) => {
      lines.push(serializeNode(child as CtrlFlowNode, depth + 2, indent));
    });
    lines.push(`${childPad}</SubNodes>`);
  }

  lines.push(`${pad}</${tagName}>`);
  return lines.join('\n');
}

export function stringifyCtrlFlowToXml(
  node: CtrlFlowNode,
  options?: {
    indent?: string;
    includeXmlDeclaration?: boolean;
  }
): string {
  const indent = options?.indent ?? '  ';
  const includeXmlDeclaration = options?.includeXmlDeclaration !== false;
  const body = serializeNode(node, 0, indent);
  if (!includeXmlDeclaration) {
    return body;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}
