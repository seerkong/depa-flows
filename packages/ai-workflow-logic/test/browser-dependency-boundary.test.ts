import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

test('browser runtime source graph excludes host selection and code compilation', () => {
  const root = resolve(import.meta.dir, '../../..');
  const configPath = join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  const visited = new Set<string>();
  const imports = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.every(item => item.isTypeOnly)) continue;
      } else {
        if (statement.isTypeOnly) continue;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)
          && statement.exportClause.elements.every(item => item.isTypeOnly)) continue;
      }
      imports.add(specifier.text);
      const resolved = ts.resolveModuleName(specifier.text, path, options, ts.sys).resolvedModule?.resolvedFileName;
      // Follow local package source. External owner barrels remain explicit boundaries.
      if (resolved?.startsWith(`${join(root, 'packages')}/`) && !resolved.endsWith('.d.ts')) visit(resolved);
    }
  };
  visit(join(root, 'packages/ai-workflow-logic/src/browser.ts'));
  expect([...visited].map(path => path.slice(root.length + 1)))
    .not.toContain('packages/ai-workflow-logic/src/agent-definition-selection.ts');
  expect([...visited].map(path => path.slice(root.length + 1)))
    .not.toContain('packages/ai-workflow-logic/src/agent-code-execution.ts');
  expect([...imports].filter(value => /halfcode.*(?:authoring-runtime|application-assembly)/.test(value))).toEqual([]);
});

test('root retains selection while browser retains pure projection and checkpoint APIs', async () => {
  const root = await import('ai-workflow-logic');
  const browser = await import('ai-workflow-logic/browser');
  expect(typeof root.admitAIAgentDefinitionSelection).toBe('function');
  expect(typeof root.createAIAgentDefinitionSelectionOwner).toBe('function');
  expect(browser.projectAIWorkflowAgentResources).toBe(root.projectAIWorkflowAgentResources);
  expect(browser.projectAIWorkflowAppBundles).toBe(root.projectAIWorkflowAppBundles);
  expect(browser.normalizeFlowClosedObject).toBe(root.normalizeFlowClosedObject);
  expect(browser.InMemoryFlowRunCheckpointStore).toBe(root.InMemoryFlowRunCheckpointStore);
  expect('admitAIAgentDefinitionSelection' in browser).toBe(false);
  expect('createAIAgentDefinitionSelectionOwner' in browser).toBe(false);
});
