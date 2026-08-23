import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FlowCodeFunction, FlowCodeResolver, LoadFlowSourcesOptions } from 'instant-ctrl-flow-contract';
import { loadFlowBundleFromSources, type LoadResult } from './loader.js';
import {
  assembleDefinitionStepProfileDirectory,
  createFilesystemDefinitionStepProfileRuntime,
} from 'flow-step-space-logic/filesystem';
import { FlowLoadError, runInstantCtrlFlowSpec } from './engine.js';
import type { InstantCtrlFlowRunOptions } from 'instant-ctrl-flow-contract';

/** Filesystem convenience only; parsing and validation belong to the named-source loader. */
export function loadFlowBundle(dir: string, options: LoadFlowSourcesOptions = {}): LoadResult {
  const absoluteDir = path.resolve(dir);
  const stepRuntime = createFilesystemDefinitionStepProfileRuntime({ rootDir: absoluteDir });
  const sources = fs.existsSync(absoluteDir)
    ? fs.readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.xnl'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          content: fs.readFileSync(path.join(absoluteDir, entry.name), 'utf8'),
        }))
    : [];
  for (const profileRoot of ['InstantCtrlFlow', 'WorkCtrlFlow', 'BPCtrlFlow']) {
    const assembled = assembleDefinitionStepProfileDirectory(
      stepRuntime,
      {},
      { ...(options.stepSpace ?? {}), profileRoot },
    );
    if (assembled.diagnostics.length > 0) {
      return { diagnostics: assembled.diagnostics.map(({ code, message }) => ({ code, message })) };
    }
    if (!assembled.forest) continue;
    const projectedSources = (assembled.sources as readonly ({ readonly ref: string; readonly content: string } | { readonly name: string; readonly content: string })[])
      .map((source) => ({ name: 'name' in source ? source.name : source.ref, content: source.content }));
    const loaded = loadFlowBundleFromSources(projectedSources, {
      ...options,
      baseUri: options.baseUri ?? absoluteDir,
    });
    return loaded.spec
      ? { ...loaded, spec: { ...loaded.spec, definitionStepForest: assembled.forest } }
      : loaded;
  }
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

export function loadInstantCtrlFlowSpec(bundleDir: string) {
  const result = loadFlowBundle(bundleDir);
  const hard = result.diagnostics.filter((diagnostic) => diagnostic.code !== 'parser-warning');
  if (!result.spec || hard.length) {
    throw new FlowLoadError(
      result.diagnostics.map((item) => item.code),
      `failed to load InstantCtrlFlow ${bundleDir}: ${result.diagnostics.map((item) => `[${item.code}] ${item.message}`).join('; ')}`,
    );
  }
  if (result.spec.form !== 'InstantCtrlFlow') {
    throw new FlowLoadError(['form-mismatch'], `bundle ${result.spec.fqn} is a ${result.spec.form}, not an InstantCtrlFlow`);
  }
  return result.spec;
}

export async function runInstantCtrlFlow<Output = unknown>(
  bundleDir: string,
  options: InstantCtrlFlowRunOptions = {},
): Promise<Output> {
  return runInstantCtrlFlowSpec<Output>(loadInstantCtrlFlowSpec(bundleDir), {
    ...options,
    resolveCode: createFilesystemFlowCodeResolver(),
  });
}
