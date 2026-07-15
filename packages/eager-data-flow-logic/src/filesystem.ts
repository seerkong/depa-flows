import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  EagerDataFlowCode,
  EagerDataFlowCodeResolver,
  EagerDataFlowLoadResult,
  EagerDataFlowXnlSource,
  LoadEagerDataFlowOptions,
} from 'eager-data-flow-contract';
import { loadEagerDataFlowSources } from './source-loader.js';

/** Filesystem convenience only; all parsing and validation stays in the source loader. */
export function loadEagerDataFlowDirectory(
  dir: string,
  options: LoadEagerDataFlowOptions = {},
): EagerDataFlowLoadResult {
  const absoluteDir = path.resolve(dir);
  const sources: EagerDataFlowXnlSource[] = fs.existsSync(absoluteDir)
    ? fs
        .readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.xnl'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          content: fs.readFileSync(path.join(absoluteDir, entry.name), 'utf8'),
        }))
    : [];
  return loadEagerDataFlowSources(sources, {
    ...options,
    baseUri: options.baseUri ?? absoluteDir,
  });
}

export type EagerDataFlowModuleImporter = (
  specifier: string,
) => Promise<Readonly<Record<string, unknown>>>;

/** Creates an explicit filesystem-backed VFS resolver; the module importer is always caller-owned. */
export function createFilesystemCodeResolver<Runtime = unknown>(
  importModule: EagerDataFlowModuleImporter,
): EagerDataFlowCodeResolver<Runtime> {
  const modules = new Map<string, Promise<Readonly<Record<string, unknown>>>>();
  return async ({ reference, baseUri, flowId, nodeId }) => {
    const match = /^vfs:\/\/\.\/(.+)#([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(reference);
    if (!match) throw new Error(`unsupported filesystem VFS reference: ${reference}`);
    if (!baseUri) throw new Error(`${flowId}#${nodeId} has no baseUri for ${reference}`);
    const root = path.resolve(baseUri);
    const file = path.resolve(root, match[1]);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${reference} escapes EagerDataFlow baseUri`);
    }
    const specifier = pathToFileURL(file).href;
    let loaded = modules.get(specifier);
    if (!loaded) {
      loaded = importModule(specifier);
      modules.set(specifier, loaded);
    }
    const exported = (await loaded)[match[2]];
    if (typeof exported !== 'function') {
      throw new Error(`${reference} does not identify a function export`);
    }
    return exported as EagerDataFlowCode<Runtime>;
  };
}
