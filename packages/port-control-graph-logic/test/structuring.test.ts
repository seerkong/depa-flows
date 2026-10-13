import { test, expect } from "bun:test";
import { lowerPortControlGraph } from "../src/index";
const node = (id: string, role: "step" | "choice" | "exit" = "step") => ({
  id,
  role,
});
const runtime = {
  nodeId: (n: ReturnType<typeof node>) => n.id,
  shape: (n: ReturnType<typeof node>) => ({
    role: n.role,
    enter: "enter",
    next: "next",
    branches:
      n.role === "choice"
        ? [
            { port: "a", order: 0 },
            { port: "b", order: 1, default: true },
          ]
        : undefined,
  }),
};
const edge = (
  from: string,
  port: string,
  to: string,
  id = `${from}-${port}-${to}`,
) => ({ id, from: { node: from, port }, to: { node: to, port: "enter" } });
test("infer diamond next without copying shared tail; preserve source", () => {
  const g = {
    entry: "if",
    nodes: [
      node("if", "choice"),
      node("a"),
      node("b"),
      node("join"),
      node("end", "exit"),
    ],
    edges: [
      edge("if", "a", "a"),
      edge("if", "b", "b"),
      edge("a", "next", "join"),
      edge("b", "next", "join"),
      edge("join", "next", "end"),
    ],
  };
  const before = JSON.stringify(g);
  const r = lowerPortControlGraph(runtime, g);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.forest.inferredNext).toContainEqual({ owner: "if", next: "join" });
  expect(r.forest.blocks).toHaveLength(0);
  expect(r.forest.statements.map((x) => x.kind)).toEqual([
    "choice",
    "node",
    "node",
  ]);
  expect(JSON.stringify(g)).toBe(before);
});
test("partial nested merge emits reusable block rather than hoisting into all branches", () => {
  const g = {
    entry: "if",
    nodes: [
      node("if", "choice"),
      node("nested", "choice"),
      node("a"),
      node("shared"),
      node("stop", "exit"),
    ],
    edges: [
      edge("if", "a", "nested"),
      edge("if", "b", "shared"),
      edge("nested", "a", "a"),
      edge("nested", "b", "stop"),
      edge("a", "next", "shared"),
    ],
  };
  const r = lowerPortControlGraph(runtime, g);
  expect(r.ok).toBe(true);
  if (r.ok)
    expect(r.forest.blocks.some((b) => b.source === "shared")).toBe(true);
});
test("same node pair different named ports stays distinct; implicit parallel/cycles rejected", () => {
  const g = {
    entry: "if",
    nodes: [node("if", "choice"), node("end", "exit")],
    edges: [edge("if", "a", "end"), edge("if", "b", "end")],
  };
  expect(lowerPortControlGraph(runtime, g).ok).toBe(true);
  const bad = lowerPortControlGraph(runtime, {
    ...g,
    edges: [...g.edges, edge("if", "a", "end", "other")],
  });
  expect(bad.ok).toBe(false);
  expect(
    lowerPortControlGraph(runtime, {
      entry: "a",
      nodes: [node("a")],
      edges: [edge("a", "next", "a")],
    }).ok,
  ).toBe(false);
});
test("second concrete type uses numeric IDs and ports", () => {
  const r = lowerPortControlGraph(
    {
      nodeId: (n: { key: number }) => n.key,
      shape: () => ({ role: "step" as const, enter: 0, next: 1 }),
    },
    {
      entry: 1,
      nodes: [{ key: 1 }, { key: 2 }],
      edges: [{ id: 99, from: { node: 1, port: 1 }, to: { node: 2, port: 0 } }],
    },
  );
  expect(r.ok).toBe(true);
});

test("inconsistent runtime port schemas fail instead of losing connected control paths", () => {
  for (const shape of [
    {
      role: "step" as const,
      enter: "enter",
      next: "next",
      branches: [{ port: "ignored", order: 0 }],
    },
    { role: "step" as const, enter: "enter", next: "next", body: "ignored" },
    { role: "step" as const, enter: "same", next: "same" },
    { role: "loop" as const, enter: "enter", next: "next", body: "next" },
  ]) {
    const result = lowerPortControlGraph(
      { nodeId: (n: number) => n, shape: () => shape },
      { entry: 1, nodes: [1], edges: [] },
    );
    expect(result.ok).toBe(false);
  }
});

test("explicit next contradicting connected branch convergence is diagnosed", () => {
  const g = {
    entry: "if",
    nodes: [
      node("if", "choice"),
      node("a"),
      node("b"),
      node("shared"),
      node("wrong"),
    ],
    edges: [
      edge("if", "a", "a"),
      edge("if", "b", "b"),
      edge("a", "next", "shared"),
      edge("b", "next", "shared"),
      edge("if", "next", "wrong"),
    ],
  };
  const r = lowerPortControlGraph(runtime, g);
  expect(r.ok).toBe(false);
  if (!r.ok)
    expect(r.diagnostics.map((d) => d.code)).toContain("next-conflict");
});
test("structure and traversal are independent of node/edge insertion order", () => {
  const g = {
    entry: "if",
    nodes: [
      node("if", "choice"),
      node("nested", "choice"),
      node("a"),
      node("shared"),
      node("stop", "exit"),
    ],
    edges: [
      edge("if", "a", "nested"),
      edge("if", "b", "shared"),
      edge("nested", "a", "a"),
      edge("nested", "b", "stop"),
      edge("a", "next", "shared"),
    ],
  };
  expect(
    lowerPortControlGraph(runtime, {
      ...g,
      nodes: [...g.nodes].reverse(),
      edges: [...g.edges].reverse(),
    }),
  ).toEqual(lowerPortControlGraph(runtime, g));
});

test("isolated entry is reachable, disconnected nodes and cycles keep source diagnostics", () => {
  expect(lowerPortControlGraph(runtime, { entry: "only", nodes: [node("only")], edges: [] }).ok).toBe(true);
  const disconnected = lowerPortControlGraph(runtime, {
    entry: "entry", nodes: [node("entry"), node("orphan")], edges: [],
  });
  expect(disconnected).toEqual({ ok: false, diagnostics: [
    { code: "unreachable-node", message: "node is not reachable from entry", node: "orphan", edge: undefined },
  ] });
  const cycle = lowerPortControlGraph(runtime, {
    entry: "a", nodes: [node("a"), node("b")],
    edges: [edge("a", "next", "b"), edge("b", "next", "a")],
  });
  expect(cycle.ok).toBe(false);
  if (!cycle.ok) expect(cycle.diagnostics).toContainEqual({
    code: "unstructured-cycle", message: "use structured loop body; arbitrary back-edge is not supported", node: "a", edge: undefined,
  });
});

test("explicit next may equal or follow branch convergence, but cannot precede it", () => {
  const g = {
    entry: "if", nodes: [node("if", "choice"), node("a"), node("b"), node("join"), node("end", "exit")],
    edges: [edge("if", "a", "a"), edge("if", "b", "b"), edge("a", "next", "join"), edge("b", "next", "join"), edge("join", "next", "end")],
  };
  for (const next of ["join", "end"]) {
    expect(lowerPortControlGraph(runtime, { ...g, edges: [...g.edges, edge("if", "next", next)] }).ok).toBe(true);
  }
});

test("symbol node and port identities are preserved without coercion or input mutation", () => {
  const start = Symbol("same"), end = Symbol("same"), enter = Symbol("enter"), next = Symbol("next");
  const nodes = Object.freeze([Object.freeze({ id: start }), Object.freeze({ id: end })]);
  const edges = Object.freeze([Object.freeze({ id: Symbol("edge"), from: Object.freeze({ node: start, port: next }), to: Object.freeze({ node: end, port: enter }) })]);
  const graph = Object.freeze({ entry: start, nodes, edges });
  const result = lowerPortControlGraph({ nodeId: (n: { id: symbol }) => n.id, shape: () => ({ role: "step" as const, enter, next }) }, graph);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.forest.statements).toEqual(nodes.map(node => ({ kind: "node", node })));
  expect(graph.nodes).toBe(nodes);
  expect(graph.edges).toBe(edges);
});

test("validation keeps edge identity, endpoint and port failures locatable", () => {
  const graph = { entry: "a", nodes: [node("a"), node("b")], edges: [edge("a", "next", "b")] };
  const cases = [
    { graph: { ...graph, entry: "missing" }, code: "missing-entry" },
    { graph: { ...graph, nodes: [...graph.nodes, node("a")] }, code: "duplicate-node" },
    { graph: { ...graph, edges: [...graph.edges, edge("a", "next", "b")] }, code: "duplicate-edge" },
    { graph: { ...graph, edges: [edge("a", "next", "missing")] }, code: "dangling-edge" },
    { graph: { ...graph, edges: [edge("a", "invalid", "b")] }, code: "invalid-port" },
  ];
  for (const item of cases) {
    const result = lowerPortControlGraph(runtime, item.graph);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map(d => d.code)).toContain(item.code);
  }
});

test("node, edge and structural context budgets reject over-limit and allow explicit bounds", () => {
  const graph = { entry: "a", nodes: [node("a"), node("b")], edges: [edge("a", "next", "b")] };
  for (const budget of [{ maxNodes: 1 }, { maxEdges: 0 }, { maxUnits: 1 }]) {
    expect(lowerPortControlGraph(runtime, graph, budget).ok).toBe(false);
  }
  expect(lowerPortControlGraph(runtime, graph, { maxNodes: 2, maxEdges: 1, maxUnits: 2 }).ok).toBe(true);
  const nodes = Array.from({ length: 1000 }, (_, i) => node(String(i)));
  const edges = nodes.slice(1).map((n, i) => edge(String(i), "next", n.id));
  expect(lowerPortControlGraph(runtime, { entry: "0", nodes, edges }).ok).toBe(true);
  expect(lowerPortControlGraph(runtime, { entry: "0", nodes: [...nodes, node("1000")], edges: [...edges, edge("999", "next", "1000")] }).ok).toBe(false);
});
