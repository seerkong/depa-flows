import { test, expect } from "bun:test";
import { compileCtrlFlowGraph, parseCtrlFlowGraph } from "../src/graph";
import { runInstantCtrlFlowSpec } from "../src/browser";
const n = (tag: string, id: string, attrs = "") => `<${tag} #${id} ${attrs}>`;
const run = (id: string) => n("Run", id, `{src="vfs://./code.ts#${id}"}`);
const ret = (id: string) => n("Return", id, `{src="vfs://./code.ts#${id}"}`);
const choice = (id: string) =>
  `<If #${id} (<Ports [<Port #yes {order=0 when="vfs://./code.ts#${id}"}><Port #no {order=1 default=true}>]>)>`;
const edge = (id: string, port: string, to: string) =>
  `<Edge #${id}_${port}_${to} {from="port://#${id}/${port}" to="port://#${to}/enter"}>`;
const graph = (nodes: string[], edges: string[]) =>
  `<CtrlFlowGraph #test.Trace apiVersion="depa.flows/v1" version="1.0.0" {targetForm="InstantCtrlFlow" entry="entry"} (<FlowContract #test.Trace {input="vfs://./c.ts#Input" output="vfs://./c.ts#Output"}><Nodes [${nodes.join("")} ]><Edges [${edges.join("")} ]>)>`;
/** Independent graph interpreter used only as trace oracle. It never calls the structuring helper. */
async function compare(
  source: string,
  flags: Record<string, boolean> = {},
  fault?: string,
) {
  const g = parseCtrlFlowGraph(source).graph;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const link = (id: string, p: string) =>
    g.edges.find((e) => e.from.node === id && e.from.port === p)?.to.node;
  const trace: string[] = [];
  let value: any = { count: 0 };
  let returned = false;
  let oracleFault = false;
  const code = (id: string, x: any) => {
    trace.push(id);
    if (id === fault) throw Error("fault");
    if (id in flags) return flags[id];
    if (id === "doneLoop") return x.count >= 2;
    return { ...x, count: x.count + 1 };
  };
  const walk = (start: string | undefined, stop?: string) => {
    let id = start,
      budget = 100;
    while (id && id !== stop && !returned) {
      if (--budget < 0) throw Error("budget");
      const node = byId.get(id)!;
      const next = link(id, "next");
      if (node.tag === "Run") value = code(id, value);
      else if (node.tag === "Return") {
        value = code(id, value);
        returned = true;
      } else if (node.tag === "If") {
        const ports = [...node.sections.Ports.children].sort(
          (a, b) => Number(a.attrs.order) - Number(b.attrs.order),
        );
        const p = ports.find(
          (p) =>
            p.attrs.default || code(String(p.attrs.when).split("#")[1], value),
        );
        if (p) walk(link(id, p.id!), next ?? stop);
      } else if (node.tag === "Until") {
        let iterations = 0;
        while (!returned && !code("doneLoop", value)) {
          if (iterations++ >= 3) throw Error("loop budget");
          walk(link(id, "body"), stop);
        }
      }
      id = next;
    }
  };
  try {
    walk(g.entry);
  } catch {
    oracleFault = true;
  }
  const expected = { trace: [...trace], value: { ...value } };
  trace.length = 0;
  const compiled = compileCtrlFlowGraph(source);
  let output: any,
    actualFault = false;
  try {
    output = await runInstantCtrlFlowSpec(compiled.spec, {
      input: { count: 0 },
      resolveCode:
        ({ reference }) =>
        (_r, x) =>
          code(reference.split("#")[1], x),
    });
  } catch {
    actualFault = true;
  }
  expect(actualFault).toBe(oracleFault);
  expect(trace).toEqual(expected.trace);
  if (!actualFault) expect(output).toEqual(expected.value);
  return compiled;
}
const nested = graph(
  [
    run("entry"),
    choice("a"),
    choice("b"),
    choice("c"),
    run("x"),
    run("shared"),
    run("other"),
    ret("done"),
  ],
  [
    edge("entry", "next", "a"),
    edge("a", "yes", "b"),
    edge("a", "no", "x"),
    edge("b", "yes", "c"),
    edge("b", "no", "shared"),
    edge("c", "yes", "other"),
    edge("c", "no", "shared"),
    edge("x", "next", "done"),
    edge("shared", "next", "done"),
  ],
);
test("Kaleido nested partial joins preserve all eight path traces", async () => {
  for (const a of [false, true])
    for (const b of [false, true])
      for (const c of [false, true]) {
        const result = await compare(nested, { a, b, c });
        expect(Object.keys(result.spec.blocks ?? {}).length).toBeGreaterThan(0);
      }
});
test("block predicate/action faults keep original trace and skip caller continuation", async () => {
  await compare(nested, { a: true, b: false, c: true }, "shared");
  await compare(nested, { a: true, b: true, c: true }, "b");
});
test("explicit next and duplicated branch boundary run continuation once", async () => {
  const src = graph(
    [run("entry"), choice("a"), run("x"), run("y"), ret("done")],
    [
      edge("entry", "next", "a"),
      edge("a", "next", "done"),
      edge("a", "yes", "x"),
      edge("a", "no", "y"),
      edge("x", "next", "done"),
      edge("y", "next", "done"),
    ],
  );
  for (const a of [true, false]) await compare(src, { a });
});
test("loop body and loop next share block in caller scope, preserving invocation count", async () => {
  const src = graph(
    [
      run("entry"),
      n("Until", "loop", '{when="vfs://./code.ts#doneLoop" maxIterations=3}'),
      run("shared"),
    ],
    [
      edge("entry", "next", "loop"),
      edge("loop", "body", "shared"),
      edge("loop", "next", "shared"),
    ],
  );
  const r = await compare(src);
  expect(Object.keys(r.spec.blocks ?? {})).toHaveLength(1);
});
test("Return from block inside loop exits flow, skips loop check and next", async () => {
  const src = graph(
    [
      run("entry"),
      n("Until", "loop", '{when="vfs://./code.ts#doneLoop" maxIterations=3}'),
      ret("done"),
    ],
    [
      edge("entry", "next", "loop"),
      edge("loop", "body", "done"),
      edge("loop", "next", "done"),
    ],
  );
  await compare(src);
});
