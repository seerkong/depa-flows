import fs from 'node:fs';
import path from 'node:path';
import { parseXnl } from 'xnl-core';

export const FORMS = ['InstantFlow', 'WorkFlow', 'BizProcess'];

export const FACET_TAGS = {
  'flow.contract': 'FlowContract',
  config: 'Config',
  'config.def': 'ConfigDef',
  'state.def': 'StateDef',
  'state.seed': 'StateSeed',
  'task.space': 'TaskSpace',
};

const TAG_TO_FACET = Object.fromEntries(Object.entries(FACET_TAGS).map(([name, tag]) => [tag, name]));
const LEGACY_ROOT_CODES = {
  Tree: ['legacy-tree-domain', 'Tree authoring is removed; put statements directly in the product root []'],
  ActionTypes: ['legacy-action-types-domain', 'action.types authoring is removed; put code refs on statements'],
  CtrlFlow: ['legacy-ctrl-flow-root', 'standalone CtrlFlow is removed; use an InstantFlow, WorkFlow, or BizProcess root'],
  DataFlow: ['legacy-data-flow-root', 'DataFlow is removed; data DAG definitions use EagerDataFlow'],
};

export const els = (nodes) =>
  (nodes ?? []).filter((node) => node && (node.kind === 'DataElement' || node.kind === 'TextElement'));

export const listChildren = (element) => els(element?.body);

export const sectionChildren = (element) => {
  if (!element?.extend) return [];
  const order = element.extend.order ?? Object.keys(element.extend.children ?? {});
  return order.map((key) => element.extend.children[key]);
};

export const children = (element) => [...listChildren(element), ...sectionChildren(element)];

export const idOf = (element) => {
  if (!element?.id) return undefined;
  const namespace = element.id.namespace?.length ? `${element.id.namespace.join('.')}.` : '';
  return namespace + element.id.name;
};

export function loadBundle(dir) {
  const diagnostics = [];
  const noted = new Set();
  const note = (code, message) => diagnostics.push({ code, message });
  const noteOnce = (code, message) => {
    if (noted.has(code)) return;
    noted.add(code);
    note(code, message);
  };

  const xnlFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((file) => file.endsWith('.xnl')).sort()
    : [];
  if (!xnlFiles.length) {
    note('empty-bundle', `no .xnl files in ${dir}`);
    return { diagnostics };
  }

  const fileRoots = {};
  for (const file of xnlFiles) {
    let document;
    try {
      document = parseXnl(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (error) {
      note('parse-error', `${file}: ${error.message}`);
      continue;
    }

    for (const warning of document.warnings ?? []) {
      note('parser-warning', `${file}: ${warning.code ?? warning.message ?? String(warning)}`);
    }
    for (const element of els(document.nodes)) {
      if (fileRoots[element.tag]) {
        note('duplicate-file-root', `root <${element.tag}> appears in both ${fileRoots[element.tag].file} and ${file}`);
      }
      fileRoots[element.tag] = { element, file };
    }
  }

  for (const [tag, [code, message]] of Object.entries(LEGACY_ROOT_CODES)) {
    if (fileRoots[tag]) noteOnce(code, message);
  }

  const form = FORMS.find((candidate) => fileRoots[candidate]);
  if (!form) {
    if (!diagnostics.length) note('no-container', `no InstantFlow, WorkFlow, or BizProcess root found in ${dir}`);
    return { diagnostics };
  }

  const container = fileRoots[form].element;
  const containerFile = fileRoots[form].file;
  const facets = {};

  for (const [tag, { element, file }] of Object.entries(fileRoots)) {
    const name = TAG_TO_FACET[tag];
    if (!name || file === containerFile) continue;
    if (file !== `${name}.xnl`) {
      note('facet-file-name-mismatch', `facet "${name}" root <${tag}> found in ${file}, expected ${name}.xnl`);
    }
    facets[name] = element;
  }

  for (const section of sectionChildren(container)) {
    const legacy = LEGACY_ROOT_CODES[section.tag];
    if (legacy) noteOnce(legacy[0], legacy[1]);

    const name = TAG_TO_FACET[section.tag];
    if (!name) continue;
    if (facets[name]) note('facet-double-definition', `facet "${name}" defined both inline and as a file`);
    else facets[name] = section;
  }

  return {
    form,
    container,
    fqn: idOf(container),
    statements: listChildren(container),
    facets,
    dir,
    diagnostics,
  };
}
