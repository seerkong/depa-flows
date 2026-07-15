#!/usr/bin/env bun
// flow-dsl-check CLI：校验流定义 bundle。
// 用法：bun tools/flow-dsl-check/check.mjs <bundle-dir>...
//       目录若无 .xnl 但含子目录，则视为 bundle 集合逐个校验。
import fs from 'node:fs';
import path from 'node:path';
import { loadBundle } from './load.mjs';
import { checkBundle } from './rules.mjs';

export function checkDir(dir) {
  const bundle = loadBundle(dir);
  return {
    dir,
    form: bundle.form,
    statements: bundle.statements ?? [],
    facets: bundle.facets ?? {},
    problems: checkBundle(bundle),
  };
}

const isBundleDir = (d) => fs.readdirSync(d).some((f) => f.endsWith('.xnl'));

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('usage: bun tools/flow-dsl-check/check.mjs <bundle-dir>...');
    process.exit(2);
  }
  const targets = args.flatMap((a) => {
    if (!fs.existsSync(a) || !fs.statSync(a).isDirectory()) {
      console.error(`not a directory: ${a}`);
      process.exit(2);
    }
    if (isBundleDir(a)) return [a];
    return fs.readdirSync(a, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isBundleDir(path.join(a, e.name)))
      .map((e) => path.join(a, e.name));
  });

  let bad = 0;
  for (const dir of targets) {
    const { form, problems } = checkDir(dir);
    if (problems.length) {
      bad++;
      console.log(`✗ ${dir}${form ? ` (${form})` : ''} — ${problems.length} problem(s)`);
      for (const p of problems) console.log(`    [${p.code}] ${p.message}`);
    } else {
      console.log(`✓ ${dir} (${form})`);
    }
  }
  process.exit(bad ? 1 : 0);
}
