import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileCtrlFlowGraph } from "../src/graph";
import { runInstantCtrlFlowSpec } from "../src/browser";
import { createFilesystemFlowCodeResolver } from "../src/filesystem";
import { loadFlowBundleFromSources } from "../src/loader";
const fixtures = path.resolve(import.meta.dir, "../../../examples/xnl-bundles");
for (const [name, input, trace, count] of [
  [
    "diamond",
    { accepted: true },
    ["load", "accepted", "charge", "audit", "done"],
    4,
  ],
  [
    "nested",
    { a: true, b: false, c: false },
    ["entry", "a", "b", "shared", "done"],
    3,
  ],
  ["partial", { route: "A" }, ["entry", "routeA", "runA", "shared", "finishShared"], 3],
  ["loop", { iterations: 3 }, ["entry", "doneLoop", "evenIteration", "fast", "advance", "doneLoop", "evenIteration", "slow", "advance", "doneLoop", "evenIteration", "fast", "advance", "doneLoop", "finalize", "done"], 8],
] as const) {
  test(`${name}: real XNL, public code references, immutable receipt and generated tree`, async () => {
    const root = path.join(fixtures, `port-ctrl-graph-${name}`);
    const source = await readFile(path.join(root, "manifest.xnl"), "utf8");
    const compiled = compileCtrlFlowGraph(source, { baseUri: root });
    expect(compiled.source).toBe(
      await readFile(
        path.join(root, "verification/generated-tree.xnl"),
        "utf8",
      ),
    );
    const receipt = JSON.parse(
      await readFile(
        path.join(root, "verification/compile-receipt.json"),
        "utf8",
      ),
    );
    expect(compiled.receipt).toEqual(receipt.receipt);
    expect(compiled.provenance).toEqual(receipt.provenance);
    const runtime = { trace: [] as string[] };
    const output = await runInstantCtrlFlowSpec<{ count: number }>(
      compiled.spec,
      { input, runtime, resolveCode: createFilesystemFlowCodeResolver() },
    );
    expect(runtime.trace).toEqual([...trace]);
    expect(output.count).toBe(count);
    expect(compiled.receipt.sourceDigest).not.toBe(
      compileCtrlFlowGraph(source + "\n").receipt.sourceDigest,
    );
    expect(compiled.receipt.outputDigest).toBe(
      compileCtrlFlowGraph(source + "\n").receipt.outputDigest,
    );
  });
}
test("three-way partial join is exactly two trees: A/B call the shared block, C never does", async () => {
  const root = path.join(fixtures, "port-ctrl-graph-partial");
  const compiled = compileCtrlFlowGraph(await readFile(path.join(root, "manifest.xnl"), "utf8"), { baseUri: root });
  expect(compiled.spec.statements.map((node) => node.id)).toEqual(["entry", "route"]);
  expect(compiled.inferredNext).toEqual([]);
  const blocks = Object.entries(compiled.spec.blocks!);
  expect(blocks).toHaveLength(1);
  expect(blocks[0][1].map((node) => node.id)).toEqual(["shared", "finishShared"]);
  const branches = compiled.spec.statements[1].sections.Branches.children;
  for (const [index, run] of [[0, "runA"], [1, "runB"]] as const) {
    expect(branches[index].children.map((node) => node.tag)).toEqual(["Run", "RunBlock"]);
    expect(branches[index].children[0].id).toBe(run);
    expect(branches[index].children[1].attrs.block).toBe(`block://#${blocks[0][0]}`);
  }
  expect(branches[2].children.map((node) => node.id)).toEqual(["runC", "finishC"]);
  for (const [route, expectedTrace, outcome, count] of [
    ["A", ["entry", "routeA", "runA", "shared", "finishShared"], "shared", 3],
    ["B", ["entry", "routeA", "routeB", "runB", "shared", "finishShared"], "shared", 3],
    ["C", ["entry", "routeA", "routeB", "runC", "finishC"], "C-only", 2],
  ] as const) {
    const runtime = { trace: [] as string[] };
    const output = await runInstantCtrlFlowSpec(compiled.spec, { input: { route }, runtime, resolveCode: createFilesystemFlowCodeResolver() });
    expect(runtime.trace).toEqual([...expectedTrace]);
    expect(output).toMatchObject({ route, count, outcome });
  }
});
test("loop-body choice rejoins inside the loop; zero, repeated and bounded iterations preserve continuation", async () => {
  const root = path.join(fixtures, "port-ctrl-graph-loop");
  const compiled = compileCtrlFlowGraph(await readFile(path.join(root, "manifest.xnl"), "utf8"), { baseUri: root });
  expect(Object.keys(compiled.spec.blocks ?? {})).toHaveLength(0);
  expect(compiled.inferredNext).toEqual([{ owner: "chooseStep", next: "advance" }]);
  expect(compiled.spec.statements.map((node) => node.id)).toEqual(["entry", "loop", "finalize", "done"]);
  expect(compiled.spec.statements[1].children.map((node) => node.id)).toEqual(["chooseStep", "advance"]);
  for (const iterations of [0, 1, 3, 5]) {
    const runtime = { trace: [] as string[] };
    const output = await runInstantCtrlFlowSpec(compiled.spec, { input: { iterations }, runtime, resolveCode: createFilesystemFlowCodeResolver() });
    const expected = ["entry"];
    for (let i = 0; i < iterations; i++) expected.push("doneLoop", "evenIteration", i % 2 === 0 ? "fast" : "slow", "advance");
    expected.push("doneLoop", "finalize", "done");
    expect(runtime.trace).toEqual(expected);
    expect(output).toMatchObject({ iteration: iterations, count: 2 + iterations * 2, outcome: "loop-completed" });
  }
  await expect(runInstantCtrlFlowSpec(compiled.spec, { input: { iterations: 6 }, runtime: { trace: [] }, resolveCode: createFilesystemFlowCodeResolver() })).rejects.toThrow();
});
test("invalid branch ports/order, implicit parallel and unsupported graph profiles fail closed", async () => {
  const source = await readFile(
    path.join(fixtures, "port-ctrl-graph-diamond/manifest.xnl"),
    "utf8",
  );
  for (const [from, to] of [
    ["order = 1", "order = 0"],
    ["port://#route/accepted", "port://#route/missing"],
    ["<Run #charge", "<Parallel #charge"],
    ['targetForm = "InstantCtrlFlow"', 'targetForm = "WorkCtrlFlow"'],
    ["default = true", 'default = "true"'],
    [
      '<Run #charge { src = "vfs://./flow-code/review.ts#charge" }>',
      '<Run #charge (<Ports [<Port #ignored {order=0}>]>) { src = "vfs://./flow-code/review.ts#charge" }>',
    ],
  ] as const)
    expect(() => compileCtrlFlowGraph(source.replace(from, to))).toThrow();
});
test("layout changes invalidate receipt but preserve control structure and actual execution", async () => {
  const root = path.join(fixtures, "port-ctrl-graph-diamond");
  const source = await readFile(path.join(root, "manifest.xnl"), "utf8");
  const original = compileCtrlFlowGraph(source, { baseUri: root });
  const moved = compileCtrlFlowGraph(
    source.replace("x = 400 y = 20", "x = 900 y = 500"),
    { baseUri: root },
  );
  expect(moved.receipt.sourceDigest).not.toBe(original.receipt.sourceDigest);
  expect(moved.spec.statements).toEqual(original.spec.statements);
  expect(moved.inferredNext).toEqual(original.inferredNext);
  const observations = [];
  for (const compiled of [original, moved]) {
    const runtime = { trace: [] as string[] };
    const output = await runInstantCtrlFlowSpec(compiled.spec, {
      input: { accepted: true },
      runtime,
      resolveCode: createFilesystemFlowCodeResolver(),
    });
    observations.push({ trace: runtime.trace, output });
  }
  expect(observations[1]).toEqual(observations[0]);
});
test("persistent block profiles and context overrides are explicitly rejected", () => {
  const src =
    '<WorkCtrlFlow #test.Scope apiVersion="depa.flows/v1" version="1" (<FlowContract #test.Scope><Blocks [<Block #b [<Return #exit>]>]>) [<RunBlock #call {block="block://#b"}>]>';
  expect(
    loadFlowBundleFromSources({ "manifest.xnl": src }).diagnostics.map(
      (d) => d.code,
    ),
  ).toContain("unsupported-block-profile");
  expect(
    loadFlowBundleFromSources({
      "manifest.xnl": src
        .replaceAll("WorkCtrlFlow", "InstantCtrlFlow")
        .replace('block="block://#b"', 'block="block://#b" input=3'),
    }).diagnostics.map((d) => d.code),
  ).toContain("block-context-override");
});
