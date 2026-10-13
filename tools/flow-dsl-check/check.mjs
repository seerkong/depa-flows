#!/usr/bin/env bun
// flow-dsl-check CLI：校验流定义 bundle。
// 用法：bun tools/flow-dsl-check/check.mjs [bundle-dir]...
//       无参数时检查仓库全部 canonical examples。
//       目录若无 .xnl 但含子目录，则视为 bundle 集合逐个校验。
import fs from 'node:fs';
import path from 'node:path';
import { loadBundle } from './load.mjs';
import { checkBundle } from './rules.mjs';

export const FLOW_DSL_CHECK_RUNTIME = Object.freeze({
  extensionCodecs: Object.freeze({
    resolve(kind) {
      if (kind !== 'depa.example.review-policy') return undefined;
      return Object.freeze({
        schemaRef: 'schema://depa.example.review-policy/v1',
        codec: Object.freeze({
          normalize(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)
              || !Number.isSafeInteger(value.reviewDepth) || value.reviewDepth < 1
              || typeof value.audience !== 'string' || !value.audience.trim()) {
              throw new Error('review policy requires positive reviewDepth and audience');
            }
            return { audience: value.audience.trim(), reviewDepth: value.reviewDepth };
          },
        }),
      });
    },
  }),
});

export function checkDir(dir, runtime = FLOW_DSL_CHECK_RUNTIME) {
  const bundle = loadBundle(dir, runtime);
  return {
    dir,
    form: bundle.form,
    statements: bundle.statements ?? [],
    definitionStepForest: bundle.definitionStepForest,
    facets: bundle.facets ?? {},
    problems: checkBundle(bundle),
  };
}

const isBundleDir = (d) => fs.readdirSync(d).some((f) => f.endsWith('.xnl'));

if (import.meta.main) {
  const supplied = process.argv.slice(2);
  const args = supplied.length ? supplied : [path.resolve(import.meta.dir, '../../examples/xnl-bundles')];
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

  if (!targets.length) {
    console.error('no flow bundles found');
    process.exit(2);
  }

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
