import { mkdir, mkdtemp, writeFile, readFile, realpath, cp } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dir, "..");
const probeRoot = path.join(root, ".tmp", "port-control-consumer");
await mkdir(probeRoot, { recursive: true });
const temp = await mkdtemp(path.join(probeRoot, "candidate-"));
const env = { ...process.env, TMPDIR: temp, npm_config_cache: path.join(temp, "npm-cache"), npm_config_registry: "https://registry.npmjs.org" };
const names = [
  "port-control-graph-contract",
  "port-control-graph-logic",
  "instant-ctrl-flow-contract",
  "instant-ctrl-flow-logic",
  "flow-step-space-contract",
  "flow-step-space-logic",
  "depa-behavior-tree",
];
const tarballs = names.map((name) => {
  const info = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], {
    cwd: path.join(root, "packages", name), encoding: "utf8", env,
  }))[0];
  return path.join(temp, info.filename);
});
const dependencies = Object.fromEntries(
  names.map((name, i) => [name, "file:" + tarballs[i]]),
);
await writeFile(
  path.join(temp, "package.json"),
  JSON.stringify({
    name: "isolated-control-consumer",
    private: true,
    type: "module",
    dependencies,
    overrides: Object.fromEntries(names.map(name => [name, "$" + name])),
  }),
);
execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false", "--package-lock=true"], { cwd: temp, stdio: "pipe", env });
for (const name of names) {
  const installed = await realpath(path.join(temp, "node_modules", name));
  if (!installed.startsWith(path.join(temp, "node_modules") + path.sep)) throw Error("non-isolated package: " + name);
}
const lock = JSON.parse(await readFile(path.join(temp, "package-lock.json"), "utf8"));
const processor = lock.packages["node_modules/depa-processor"];
if (processor.version !== "0.1.1" || processor.resolved !== "https://registry.npmjs.org/depa-processor/-/depa-processor-0.1.1.tgz" || !processor.integrity?.startsWith("sha512-")) throw Error("processor must use the published registry artifact");
const graphPackage = JSON.parse(await readFile(path.join(temp, "node_modules/port-control-graph-logic/package.json"), "utf8"));
if (JSON.stringify(graphPackage.dependencies) !== JSON.stringify({ "port-control-graph-contract": "0.1.0" })) throw Error("unexpected graph dependencies");
await cp(
  path.join(
    root,
    "packages/instant-ctrl-flow-logic/test/fixtures/port-graph/diamond.xnl",
  ),
  path.join(temp, "graph.xnl"),
);
await writeFile(
  path.join(temp, "check.ts"),
  `import {compileCtrlFlowGraph} from 'instant-ctrl-flow-logic/graph';
import {lowerPortControlGraph} from 'port-control-graph-logic';
import * as processor from 'depa-processor';
import * as behavior from 'depa-behavior-tree';
import {runInstantCtrlFlowSpec} from 'instant-ctrl-flow-logic/browser';
if(typeof lowerPortControlGraph!=='function'||!Object.keys(processor).length||!Object.keys(behavior).length)throw Error('public exports missing');
const result=compileCtrlFlowGraph(await Bun.file('./graph.xnl').text());
const trace=[];await runInstantCtrlFlowSpec(result.spec,{input:{accepted:true},resolveCode:({reference})=>(_r,x)=>{trace.push(reference.split('#')[1]);return reference.endsWith('#isAccepted')?true:x;}});
if(trace.join(',')!=='load,isAccepted,charge,audit,done')throw Error('trace mismatch '+trace);
console.log('ISOLATED_PORT_CONTROL_CONSUMER_OK');`,
);
console.log(
  execFileSync("bun", ["check.ts"], { cwd: temp, encoding: "utf8", env }).trim(),
);
console.log("consumer:", temp);
