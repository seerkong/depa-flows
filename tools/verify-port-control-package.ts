import { mkdtemp, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dir, "..");
const temp = await mkdtemp(path.join(tmpdir(), "port-control-consumer-"));
const names = [
  "port-control-graph-contract",
  "port-control-graph-logic",
  "instant-ctrl-flow-contract",
  "instant-ctrl-flow-logic",
  "flow-step-space-contract",
  "flow-step-space-logic",
  "depa-behavior-tree",
];
const tarballs = names.map((n) =>
  path.join(
    temp,
    execFileSync("npm", ["pack", "--pack-destination", temp, "--silent"], {
      cwd: path.join(root, "packages", n),
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1)!,
  ),
);
tarballs.push(
  path.join(
    temp,
    execFileSync("npm", ["pack", "--pack-destination", temp, "--silent"], {
      cwd: path.resolve(root, "../depa-processor"),
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .at(-1)!,
  ),
);
const dependencies = Object.fromEntries(
  [...names, "depa-processor"].map((name, i) => [name, "file:" + tarballs[i]]),
);
await writeFile(
  path.join(temp, "package.json"),
  JSON.stringify({
    name: "isolated-control-consumer",
    private: true,
    type: "module",
    dependencies,
    overrides: dependencies,
  }),
);
execFileSync("bun", ["install"], { cwd: temp, stdio: "pipe" });
await cp(
  path.join(
    root,
    "packages/instant-ctrl-flow-logic/test/fixtures/port-graph/diamond.xnl",
  ),
  path.join(temp, "graph.xnl"),
);
await writeFile(
  path.join(temp, "check.ts"),
  `import {SingleEntryGraph} from 'depa-processor/algo';
import {compileCtrlFlowGraph} from 'instant-ctrl-flow-logic/graph';
import {runInstantCtrlFlowSpec} from 'instant-ctrl-flow-logic/browser';
const g=new SingleEntryGraph();if(!g)throw Error('public algo missing');
const result=compileCtrlFlowGraph(await Bun.file('./graph.xnl').text());
const trace=[];await runInstantCtrlFlowSpec(result.spec,{input:{accepted:true},resolveCode:({reference})=>(_r,x)=>{trace.push(reference.split('#')[1]);return reference.endsWith('#isAccepted')?true:x;}});
if(trace.join(',')!=='load,isAccepted,charge,audit,done')throw Error('trace mismatch '+trace);
console.log('ISOLATED_PORT_CONTROL_CONSUMER_OK');`,
);
console.log(
  execFileSync("bun", ["check.ts"], { cwd: temp, encoding: "utf8" }).trim(),
);
console.log("consumer:", temp);
