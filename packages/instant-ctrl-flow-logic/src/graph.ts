import { createHash } from "node:crypto";
import { parseXnl, type DataElementNode } from "xnl-core";
import {
  lowerPortControlGraph,
  type ControlShape,
  type PortControlGraph,
  type StructuredStatement,
} from "port-control-graph-logic";
import type { FlowBundleSpec, FlowNodeSpec } from "instant-ctrl-flow-contract";
import { loadFlowBundleFromSources } from "./loader.js";

export const CTRL_GRAPH_COMPILER = "depa.flows/port-ctrl-graph-to-tree@1";
export interface CtrlGraphDocument {
  readonly root: FlowNodeSpec;
  readonly graph: PortControlGraph<FlowNodeSpec, string, string, string>;
}
export interface CtrlGraphCompileReceipt {
  readonly schemaVersion: "depa.flows/ctrl-graph-receipt/v1";
  readonly compiler: typeof CTRL_GRAPH_COMPILER;
  readonly profile: "InstantCtrlFlow";
  readonly sourceDigest: string;
  readonly outputDigest: string;
}
export interface CompiledCtrlGraph {
  readonly source: string;
  readonly spec: FlowBundleSpec;
  readonly provenance: Readonly<Record<string, string>>;
  readonly inferredNext: readonly {
    readonly owner: string;
    readonly next: string;
  }[];
  readonly receipt: CtrlGraphCompileReceipt;
}

function isDataElement(value: unknown): value is DataElementNode {
  return Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "DataElement",
  );
}
function project(element: DataElementNode): FlowNodeSpec {
  return {
    tag: element.tag,
    id: element.id
      ? [...(element.id.namespace ?? []), element.id.name].join(".")
      : undefined,
    metadata: { ...element.metadata },
    attrs: { ...element.attributes },
    children: (element.body ?? []).filter(isDataElement).map(project),
    sections: Object.fromEntries(
      Object.values(element.extend?.children ?? {}).map((section) => [
        section.tag,
        project(section as DataElementNode),
      ]),
    ),
  };
}
function endpoint(value: unknown): { node: string; port: string } {
  const match =
    typeof value === "string" && /^port:\/\/#([-\w.]+)\/([-\w.]+)$/.exec(value);
  if (!match) throw new Error(`invalid port URI: ${String(value)}`);
  return { node: match[1], port: match[2] };
}
export function parseCtrlFlowGraph(source: string): CtrlGraphDocument {
  const parsed = parseXnl(source);
  if (parsed.warnings?.length)
    throw new Error(
      `graph parser warnings: ${JSON.stringify(parsed.warnings)}`,
    );
  const roots = parsed.nodes.filter(isDataElement).map(project);
  if (roots.length !== 1 || roots[0].tag !== "CtrlFlowGraph")
    throw new Error("expected one CtrlFlowGraph root");
  const root = roots[0];
  if (root.attrs.targetForm !== "InstantCtrlFlow")
    throw new Error("only InstantCtrlFlow graph profile is supported");
  if (root.children.length || root.sections.Regions)
    throw new Error(
      "graph statements belong in Nodes; explicit Regions are unsupported",
    );
  const match = /^(?:ctrl-node:\/\/#)?([-\w.]+)$/.exec(
    String(root.attrs.entry ?? ""),
  );
  if (!match) throw new Error("invalid graph entry");
  if (!root.sections.Nodes || !root.sections.Edges)
    throw new Error("graph requires Nodes and Edges");
  return {
    root,
    graph: {
      entry: match[1],
      nodes: root.sections.Nodes.children,
      edges: root.sections.Edges.children.map((edge) => {
        if (edge.tag !== "Edge" || !edge.id)
          throw new Error("Edges requires named Edge");
        return {
          id: edge.id,
          from: endpoint(edge.attrs.from),
          to: endpoint(edge.attrs.to),
        };
      }),
    },
  };
}
export const ctrlGraphRuntime = {
  nodeId(node: FlowNodeSpec): string {
    if (!node.id) throw new Error("graph node requires identity");
    return node.id;
  },
  shape(node: FlowNodeSpec): ControlShape<string> {
    if (node.children.length)
      throw new Error(
        `graph node #${node.id} cannot contain inline statements`,
      );
    for (const section of Object.keys(node.sections)) {
      if (node.tag !== "If" || section !== "Ports")
        throw new Error(
          `unsupported graph node section ${section} #${node.id}`,
        );
    }
    const base = { enter: "enter", next: "next" };
    switch (node.tag) {
      case "Run":
        return { ...base, role: "step" };
      case "Return":
        return { ...base, role: "exit" };
      case "Until":
        return { ...base, role: "loop", body: "body" };
      case "If":
        return {
          ...base,
          role: "choice",
          branches: (node.sections.Ports?.children ?? []).map((port) => {
            if (port.tag !== "Port")
              throw new Error(`If #${node.id} Ports requires Port`);
            if (!port.id)
              throw new Error(`If #${node.id} requires named ports`);
            if (port.children.length || Object.keys(port.sections).length)
              throw new Error(
                `branch port #${port.id} cannot contain statements`,
              );
            if (
              port.attrs.default !== undefined &&
              typeof port.attrs.default !== "boolean"
            )
              throw new Error(
                `branch port #${port.id} default must be boolean`,
              );
            if (port.attrs.default === true && port.attrs.when !== undefined)
              throw new Error(
                `default port #${port.id} cannot have a predicate`,
              );
            return {
              port: port.id,
              order:
                typeof port.attrs.order === "number" ? port.attrs.order : NaN,
              default: port.attrs.default === true,
            };
          }),
        };
      default:
        throw new Error(`unsupported graph node ${node.tag} #${node.id}`);
    }
  },
};
function xnlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(xnlValue).join(", ")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)} = ${xnlValue(item)}`);
    return `{ ${fields.join(" ")} }`;
  }
  return JSON.stringify(value);
}
export function serializeFlowNode(node: FlowNodeSpec): string {
  const attributes = Object.entries(node.attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} = ${xnlValue(value)}`)
    .join("\n");
  const metadata = Object.entries(node.metadata)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  const sections = Object.values(node.sections)
    .map(serializeFlowNode)
    .join("\n");
  return (
    `<${node.tag}${node.id ? ` #${node.id}` : ""}${metadata ? ` ${metadata}` : ""}` +
    `${attributes ? ` {\n${attributes}\n}` : ""}${sections ? ` (\n${sections}\n)` : ""}` +
    `${node.children.length ? ` [\n${node.children.map(serializeFlowNode).join("\n")}\n]` : ""}>`
  );
}
function blank(
  tag: string,
  id?: string,
  attrs: Record<string, unknown> = {},
  children: FlowNodeSpec[] = [],
): FlowNodeSpec {
  return { tag, id, attrs, children, metadata: {}, sections: {} };
}
export function ctrlGraphSourceDigest(source: string): string {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}
export function compileCtrlFlowGraph(
  source: string,
  options: { baseUri?: string } = {},
): CompiledCtrlGraph {
  const document = parseCtrlFlowGraph(source);
  const result = lowerPortControlGraph(ctrlGraphRuntime, document.graph);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const provenance: Record<string, string> = {};
  const ids = new Set<string>();
  function identity(sourceId: string, path: string): string {
    let id = sourceId;
    const suffix = path.replace(/[^\w]/g, "_");
    let occurrence = 0;
    while (ids.has(id)) id = `${sourceId}__${suffix}_${occurrence++}`;
    ids.add(id);
    provenance[id] = sourceId;
    return id;
  }
  function lower(
    statements: readonly StructuredStatement<FlowNodeSpec, string, string>[],
    path: string,
  ): FlowNodeSpec[] {
    return statements.map((statement, index) => {
      const location = `${path}_${index}`;
      if (statement.kind === "block-ref") {
        const id = identity(`${statement.source}__ref`, location);
        provenance[id] = statement.source;
        return blank("RunBlock", id, {
          block: `block://#block_${statement.block}`,
        });
      }
      const node: FlowNodeSpec = {
        ...statement.node,
        id: identity(statement.node.id!, location),
        attrs: { ...statement.node.attrs },
        sections: {},
        children: [],
      };
      if (statement.kind === "choice") {
        node.sections.Branches = blank(
          "Branches",
          undefined,
          {},
          statement.branches.map((branch) => {
            const port = statement.node.sections.Ports.children.find(
              (item) => item.id === branch.port,
            )!;
            const body = lower(branch.body, `${location}_${branch.port}`);
            if (port.attrs.default === true)
              return blank("Otherwise", undefined, {}, body);
            return blank(
              "Branch",
              identity(`${statement.node.id}_${branch.port}`, location),
              { when: port.attrs.when, config: port.attrs.config },
              body,
            );
          }),
        );
      }
      if (statement.kind === "loop")
        node.children = lower(statement.body, `${location}_body`);
      return node;
    });
  }
  const root: FlowNodeSpec = {
    ...document.root,
    tag: "InstantCtrlFlow",
    attrs: { title: document.root.attrs.title },
    sections: { ...document.root.sections },
    children: lower(result.forest.statements, "main"),
  };
  delete root.sections.Nodes;
  delete root.sections.Edges;
  root.sections.Blocks = blank(
    "Blocks",
    undefined,
    {},
    result.forest.blocks.map((block) =>
      blank(
        "Block",
        `block_${block.id}`,
        {},
        lower(block.statements, `block_${block.id}`),
      ),
    ),
  );
  const output = serializeFlowNode(root);
  const loaded = loadFlowBundleFromSources({ "flow.xnl": output }, options);
  if (!loaded.spec || loaded.diagnostics.length)
    throw new Error(
      `invalid graph output: ${JSON.stringify(loaded.diagnostics)}`,
    );
  return {
    source: output,
    spec: loaded.spec,
    provenance: Object.freeze(provenance),
    inferredNext: result.forest.inferredNext,
    receipt: Object.freeze({
      schemaVersion: "depa.flows/ctrl-graph-receipt/v1",
      compiler: CTRL_GRAPH_COMPILER,
      profile: "InstantCtrlFlow",
      sourceDigest: ctrlGraphSourceDigest(source),
      outputDigest: ctrlGraphSourceDigest(output),
    }),
  };
}
