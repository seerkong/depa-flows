import { createAdjacencyProjection } from "./adjacency";
import type {
  ControlGraphRuntime,
  ControlShape,
  GraphDiagnostic,
  LowerGraphResult,
  PortControlGraph,
  StructuredStatement,
} from "port-control-graph-contract";
export type * from "port-control-graph-contract";

/** Pure, immutable port-preserving structuring. Node adjacency is only an analysis projection. */
export function lowerPortControlGraph<N, I, P, E>(
  runtime: ControlGraphRuntime<N, I, P>,
  graph: PortControlGraph<N, I, P, E>,
  config: { maxNodes?: number; maxEdges?: number; maxUnits?: number } = {},
): LowerGraphResult<N, I, P, E> {
  const diagnostics: GraphDiagnostic<I, E>[] = [];
  const fail = (code: string, message: string, node?: I, edge?: E) =>
    diagnostics.push({ code, message, node, edge });
  if (
    graph.nodes.length > (config.maxNodes ?? 1000) ||
    graph.edges.length > (config.maxEdges ?? 5000)
  ) {
    return {
      ok: false,
      diagnostics: [
        { code: "graph-budget", message: "graph exceeds structural budget" },
      ],
    };
  }
  const nodes = new Map<I, N>();
  const shapes = new Map<I, ControlShape<P>>();
  const outgoing = new Map<I, Map<P, I>>();
  const projection = createAdjacencyProjection<I>();
  for (const n of graph.nodes) {
    const id = runtime.nodeId(n);
    if (nodes.has(id))
      fail("duplicate-node", "node identity must be unique", id);
    nodes.set(id, n);
    shapes.set(id, runtime.shape(n));
    projection.addVertex(id);
  }
  if (!nodes.has(graph.entry))
    fail("missing-entry", "entry must name a node", graph.entry);
  const edgeIds = new Set<E>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id))
      fail(
        "duplicate-edge",
        "edge identity must be unique",
        undefined,
        edge.id,
      );
    edgeIds.add(edge.id);
    const from = shapes.get(edge.from.node),
      to = shapes.get(edge.to.node);
    if (!from || !to) {
      fail("dangling-edge", "edge endpoint does not exist", undefined, edge.id);
      continue;
    }
    const valid =
      from.role !== "exit" &&
      (edge.from.port === from.next ||
        edge.from.port === from.body ||
        from.branches?.some((b) => b.port === edge.from.port));
    if (!valid || edge.to.port !== to.enter)
      fail(
        "invalid-port",
        "edge direction or port is invalid",
        edge.from.node,
        edge.id,
      );
    const ports = outgoing.get(edge.from.node) ?? new Map<P, I>();
    if (ports.has(edge.from.port))
      fail(
        "multiple-port-edges",
        "one control output cannot fan out implicitly",
        edge.from.node,
        edge.id,
      );
    ports.set(edge.from.port, edge.to.node);
    outgoing.set(edge.from.node, ports);
    projection.addEdge(edge.from.node, edge.to.node);
  }
  for (const [id, shape] of shapes) {
    const branches = shape.branches ?? [];
    if (shape.role !== "choice" && branches.length)
      fail(
        "unexpected-branch-ports",
        "only choice nodes can declare branches",
        id,
      );
    if (shape.role !== "loop" && shape.body !== undefined)
      fail("unexpected-body-port", "only loop nodes can declare a body", id);
    if (shape.next !== undefined && shape.next === shape.enter)
      fail("ambiguous-port-schema", "enter and next must be distinct", id);
    if (
      shape.body !== undefined &&
      (shape.body === shape.enter || shape.body === shape.next)
    )
      fail("ambiguous-port-schema", "body must differ from enter and next", id);
    if (shape.role === "choice") {
      const orders = new Set(branches.map((b) => b.order));
      const ports = new Set(branches.map((b) => b.port));
      if (branches.some((b) => b.port === shape.next || b.port === shape.enter))
        fail(
          "reserved-branch-port",
          "branch port cannot shadow enter/next",
          id,
        );
      if (
        !branches.length ||
        orders.size !== branches.length ||
        ports.size !== branches.length ||
        branches.some((b) => !Number.isInteger(b.order) || b.order < 0)
      )
        fail(
          "invalid-branch-order",
          "branches require unique ports and nonnegative integer orders",
          id,
        );
      const sorted = [...branches].sort((a, b) => a.order - b.order);
      if (
        branches.filter((b) => b.default).length > 1 ||
        sorted.some((b, i) => b.default && i !== sorted.length - 1)
      )
        fail("invalid-default", "default must be unique and last", id);
    }
    if (shape.role === "loop" && shape.body === undefined)
      fail("missing-loop-body-port", "loop requires body port schema", id);
    if (shape.role === "exit" && outgoing.has(id))
      fail("exit-has-next", "flow exit cannot have outgoing edges", id);
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  for (const id of projection.unreachableFrom(graph.entry))
    fail("unreachable-node", "node is not reachable from entry", id);
  const color = new Map<I, number>();
  const visit = (id: I) => {
    if (color.get(id) === 1) {
      fail(
        "unstructured-cycle",
        "use structured loop body; arbitrary back-edge is not supported",
        id,
      );
      return;
    }
    if (color.get(id) === 2) return;
    color.set(id, 1);
    for (const next of projection.nextIds(id)) visit(next);
    color.set(id, 2);
  };
  visit(graph.entry);
  if (diagnostics.length) return { ok: false, diagnostics };
  const nextOf = (id: I, port: P | undefined) =>
    port === undefined ? undefined : outgoing.get(id)?.get(port);
  // Postdom sets include a virtual natural/flow exit; layout or insertion order never chooses a join.
  const exit = Symbol("exit");
  const post = new Map<I, Set<I | typeof exit>>();
  const postOf = (id: I | undefined): Set<I | typeof exit> => {
    if (id === undefined) return new Set([exit]);
    const cached = post.get(id);
    if (cached) return cached;
    const shape = shapes.get(id)!;
    const next = nextOf(id, shape.next);
    const successors =
      shape.role === "exit"
        ? [undefined]
        : shape.role === "choice"
          ? [
              ...(shape.branches ?? []).map((b) => nextOf(id, b.port) ?? next),
              ...((shape.branches ?? []).some((b) => b.default) ? [] : [next]),
            ]
          : [next]; // Loop body returns to owner; loop.next is its normal continuation.
    let common = postOf(successors[0]);
    for (const successor of successors.slice(1)) {
      const s = postOf(successor);
      common = new Set([...common].filter((x) => s.has(x)));
    }
    const result = new Set<I | typeof exit>([id, ...common]);
    post.set(id, result);
    return result;
  };
  const inferredNext: { owner: I; next: I }[] = [];
  const joinOf = (id: I): I | undefined => {
    const shape = shapes.get(id)!;
    const explicit = nextOf(id, shape.next);
    if (explicit !== undefined) {
      const branches = shape.branches ?? [];
      if (
        branches.every((b) => nextOf(id, b.port) !== undefined) &&
        branches.some((b) => b.default)
      ) {
        const paths = branches.map((b) => postOf(nextOf(id, b.port)));
        const common = [...paths[0]].filter(
          (x): x is I => x !== exit && paths.every((p) => p.has(x)),
        );
        if (
          common.length &&
          !common.some(
            (c) =>
              c === explicit ||
              projection.reachableFrom(c).has(explicit),
          )
        )
          fail(
            "next-conflict",
            "explicit next conflicts with common branch continuation",
            id,
          );
      }
      return explicit;
    }
    const candidates = [...postOf(id)].filter(
      (x): x is I => x !== exit && x !== id,
    );
    const nearest = candidates.find((c) =>
      candidates.every((other) => other === c || postOf(c).has(other)),
    );
    if (nearest !== undefined) inferredNext.push({ owner: id, next: nearest });
    return nearest;
  };
  type Unit = {
    id: number;
    source: I;
    stop?: I;
    node: N;
    role: ControlShape<P>["role"];
    branches: { port: P; unit?: Unit }[];
    body?: Unit;
    next?: Unit;
    uses: number;
  };
  const units: Unit[] = [];
  const memo = new Map<I, Map<I | undefined, Unit>>();
  const build = (id: I | undefined, stop?: I): Unit | undefined => {
    if (id === undefined || id === stop) return;
    const existing = memo.get(id)?.get(stop);
    if (existing) {
      existing.uses++;
      return existing;
    }
    if (units.length >= (config.maxUnits ?? 10000))
      throw new Error("structuring budget");
    const shape = shapes.get(id)!;
    const unit: Unit = {
      id: units.length,
      source: id,
      stop,
      node: nodes.get(id)!,
      role: shape.role,
      branches: [],
      uses: 1,
    };
    units.push(unit);
    const contexts = memo.get(id) ?? new Map();
    contexts.set(stop, unit);
    memo.set(id, contexts);
    const next = shape.role === "choice" ? joinOf(id) : nextOf(id, shape.next);
    if (shape.role === "choice")
      unit.branches = [...(shape.branches ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((b) => ({
          port: b.port,
          unit: build(nextOf(id, b.port), next ?? stop),
        }));
    if (shape.role === "loop") unit.body = build(nextOf(id, shape.body), stop);
    if (shape.role !== "exit") unit.next = build(next, stop);
    return unit;
  };
  let root: Unit | undefined;
  try {
    root = build(graph.entry);
  } catch {
    return {
      ok: false,
      diagnostics: [
        { code: "structuring-budget", message: "too many structural contexts" },
      ],
    };
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  type S = StructuredStatement<N, I, P>;
  const materialize = (unit?: Unit, definition = false): S[] => {
    if (!unit) return [];
    if (unit.uses > 1 && !definition)
      return [{ kind: "block-ref", block: unit.id, source: unit.source }];
    const stmt: S =
      unit.role === "choice"
        ? {
            kind: "choice",
            node: unit.node,
            branches: unit.branches.map((b) => ({
              port: b.port,
              body: materialize(b.unit),
            })),
          }
        : unit.role === "loop"
          ? { kind: "loop", node: unit.node, body: materialize(unit.body) }
          : { kind: "node", node: unit.node };
    return [stmt, ...materialize(unit.next)];
  };
  return {
    ok: true,
    forest: {
      statements: materialize(root),
      blocks: units
        .filter((u) => u.uses > 1)
        .map((u) => ({
          id: u.id,
          source: u.source,
          statements: materialize(u, true),
        })),
      inferredNext,
    },
  };
}
