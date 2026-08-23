import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCanonicalMarkdownFiles } from '../tools/source-tree.js';

describe('Flow DSL reference source boundary', () => {
  test('uses stable code-unit ordering for regular Markdown files', async () => {
    await withTemporarySource(async (root) => {
      await mkdir(join(root, 'spec'), { recursive: true });
      await writeFile(join(root, 'z.md'), 'z\n');
      await writeFile(join(root, 'README.md'), 'index\n');
      await writeFile(join(root, 'spec', 'a.md'), 'a\n');
      expect(await collectCanonicalMarkdownFiles(root)).toEqual(['README.md', 'spec/a.md', 'z.md']);
    });
  });

  test('rejects an empty source and non-Markdown file with stable diagnostics', async () => {
    await withTemporarySource(async (root) => {
      await expect(collectCanonicalMarkdownFiles(root)).rejects.toThrow('FLOW_DSL_REFERENCE_SOURCE_EMPTY');
      await writeFile(join(root, 'notes.txt'), 'not a canonical page\n');
      await expect(collectCanonicalMarkdownFiles(root)).rejects.toThrow('FLOW_DSL_REFERENCE_SOURCE_EXTENSION_INVALID: notes.txt');
    });
  });

  test('rejects a symbolic link before returning a source projection', async () => {
    await withTemporarySource(async (root) => {
      const outside = join(root, '..', 'outside-flow-dsl-page.md');
      await writeFile(outside, 'outside\n');
      try {
        await symlink(outside, join(root, 'linked.md'));
        await expect(collectCanonicalMarkdownFiles(root)).rejects.toThrow('FLOW_DSL_REFERENCE_SOURCE_SYMLINK: linked.md');
      } finally {
        await rm(outside, { force: true });
      }
    });
  });
});

async function withTemporarySource(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'depa-flow-dsl-source-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
