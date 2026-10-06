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
