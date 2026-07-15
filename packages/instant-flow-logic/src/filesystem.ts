import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FlowCodeFunction, FlowCodeResolver, LoadFlowSourcesOptions } from 'instant-flow-contract';
import { loadFlowBundleFromSources, type LoadResult } from './loader.js';
import { FlowLoadError, runInstantFlowSpec } from './engine.js';
import type { InstantFlowRunOptions } from 'instant-flow-contract';

/** Filesystem convenience only; parsing and validation belong to the named-source loader. */
export function loadFlowBundle(dir: string, options: LoadFlowSourcesOptions = {}): LoadResult {
  const absoluteDir = path.resolve(dir);
  const sources = fs.existsSync(absoluteDir)
    ? fs.readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.xnl'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          content: fs.readFileSync(path.join(absoluteDir, entry.name), 'utf8'),
        }))
    : [];
  return loadFlowBundleFromSources(sources, { ...options, baseUri: options.baseUri ?? absoluteDir });
}

export type FlowModuleImporter = (specifier: string) => Promise<Readonly<Record<string, unknown>>>;

export function createFilesystemFlowCodeResolver<Runtime = unknown>(
  importModule: FlowModuleImporter = (specifier) => import(specifier),
): FlowCodeResolver<Runtime> {
  const modules = new Map<string, Promise<Readonly<Record<string, unknown>>>>();
  return async ({ reference, baseUri, flowId, nodeId }) => {
    const match = /^vfs:\/\/\.\/(.+)#([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(reference);
    if (!match) throw new Error(`unsupported filesystem VFS reference: ${reference}`);
    if (!baseUri) throw new Error(`${flowId}#${nodeId} has no baseUri for ${reference}`);
    const root = path.resolve(baseUri);
    const file = path.resolve(root, match[1]);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${reference} escapes Flow baseUri`);
    const specifier = pathToFileURL(file).href;
    let loaded = modules.get(specifier);
    if (!loaded) {
      loaded = importModule(specifier);
      modules.set(specifier, loaded);
    }
    const resolved = (await loaded)[match[2]];
    if (typeof resolved !== 'function') throw new Error(`${reference} does not identify a function export`);
    return resolved as FlowCodeFunction<unknown, Runtime>;
  };
}

export function loadInstantFlowSpec(bundleDir: string) {
  const result = loadFlowBundle(bundleDir);
  const hard = result.diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
  if (!result.spec || hard.length) {
    throw new FlowLoadError(
      result.diagnostics.map((item) => item.code),
      `failed to load InstantFlow ${bundleDir}: ${result.diagnostics.map((item) => `[${item.code}] ${item.message}`).join('; ')}`,
    );
  }
  if (result.spec.form !== 'InstantFlow') {
    throw new FlowLoadError(['form-mismatch'], `bundle ${result.spec.fqn} is a ${result.spec.form}, not an InstantFlow`);
  }
  return result.spec;
}

export async function runInstantFlow<Output = unknown>(
  bundleDir: string,
  options: InstantFlowRunOptions = {},
): Promise<Output> {
  return runInstantFlowSpec<Output>(loadInstantFlowSpec(bundleDir), {
    ...options,
    resolveCode: createFilesystemFlowCodeResolver(),
  });
}
