import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileCtrlFlowGraph } from "instant-ctrl-flow-logic/graph";
// Explicit fixture regeneration; tests never overwrite their expected artifacts.
for (const name of ["diamond", "partial", "nested", "loop"]) {
  const root = path.resolve(
    import.meta.dir,
    `../examples/xnl-bundles/port-ctrl-graph-${name}`,
  );
  const result = compileCtrlFlowGraph(
    await readFile(path.join(root, "manifest.xnl"), "utf8"),
    { baseUri: root },
  );
  await mkdir(path.join(root, "verification"), { recursive: true });
  await writeFile(
    path.join(root, "verification/generated-tree.xnl"),
    result.source,
  );
  await writeFile(
    path.join(root, "verification/compile-receipt.json"),
    JSON.stringify(
      {
        receipt: result.receipt,
        provenance: result.provenance,
        inferredNext: result.inferredNext,
      },
      null,
      2,
    ) + "\n",
  );
}
