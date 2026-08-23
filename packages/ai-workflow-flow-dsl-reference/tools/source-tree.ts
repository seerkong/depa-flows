import { lstat, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export async function collectCanonicalMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await visit(root, '');
  if (!files.length) throw new Error('FLOW_DSL_REFERENCE_SOURCE_EMPTY: docs/flow-dsl has no Markdown files');
  return files.sort(compareCodeUnits);

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertSafeRelativePath(root, path);
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`FLOW_DSL_REFERENCE_SOURCE_SYMLINK: ${path}`);
      }
      if (metadata.isDirectory()) {
        await visit(absolutePath, path);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`FLOW_DSL_REFERENCE_SOURCE_TYPE_INVALID: ${path}`);
      }
      if (!entry.name.endsWith('.md')) {
        throw new Error(`FLOW_DSL_REFERENCE_SOURCE_EXTENSION_INVALID: ${path}`);
      }
      files.push(path);
    }
  }
}

function assertSafeRelativePath(root: string, path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\')) {
    throw new Error(`FLOW_DSL_REFERENCE_SOURCE_PATH_INVALID: ${JSON.stringify(path)}`);
  }
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..' || segment.trim() !== segment) {
      throw new Error(`FLOW_DSL_REFERENCE_SOURCE_PATH_INVALID: ${JSON.stringify(path)}`);
    }
    for (let index = 0; index < segment.length; index += 1) {
      const unit = segment.charCodeAt(index);
      if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) {
        throw new Error(`FLOW_DSL_REFERENCE_SOURCE_PATH_INVALID: ${JSON.stringify(path)}`);
      }
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = segment.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          throw new Error(`FLOW_DSL_REFERENCE_SOURCE_PATH_INVALID: ${JSON.stringify(path)}`);
        }
        index += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        throw new Error(`FLOW_DSL_REFERENCE_SOURCE_PATH_INVALID: ${JSON.stringify(path)}`);
      }
    }
  }
  const resolved = resolve(root, ...path.split('/'));
  const fromRoot = relative(root, resolved);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || resolved === resolve(root)) {
    throw new Error(`FLOW_DSL_REFERENCE_SOURCE_PATH_INVALID: ${JSON.stringify(path)}`);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
