import fs from 'node:fs';
import path from 'node:path';
import { parseXnl } from 'xnl-core';
import {
  assembleDefinitionStepProfileDirectory,
  createFilesystemDefinitionStepProfileRuntime,
} from 'flow-step-space-logic/filesystem';

export const CTRL_FLOW_FORMS = ['InstantCtrlFlow', 'WorkCtrlFlow', 'BPCtrlFlow', 'AICtrlWorkflow'];
export const DAG_FORMS = ['EagerDataFlow', 'AIDataWorkflow'];
export const FORMS = [...CTRL_FLOW_FORMS, ...DAG_FORMS];

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
  CtrlFlow: ['legacy-ctrl-flow-root', 'standalone CtrlFlow is removed; use an InstantCtrlFlow, WorkCtrlFlow, or BPCtrlFlow root'],
  DataFlow: ['legacy-data-flow-root', 'DataFlow is removed; data DAG definitions use EagerDataFlow'],
};
const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;

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

export function loadBundle(dir, runtime = { extensionCodecs: { resolve: () => undefined } }) {
  const diagnostics = [];
  const noted = new Set();
  const note = (code, message) => diagnostics.push({ code, message });
  const noteOnce = (code, message) => {
    if (noted.has(code)) return;
    noted.add(code);
    note(code, message);
  };

  const xnlFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((file) => file.endsWith('.xnl')).sort(compareCodeUnits)
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
    if (!diagnostics.length) note('no-container', `no supported flow root found in ${dir}`);
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

  const assembled = assembleDefinitionStepProfileDirectory(
    createFilesystemDefinitionStepProfileRuntime({
      rootDir: dir,
      extensionCodecs: runtime.extensionCodecs,
    }),
    {},
    { profileRoot: form },
  );
  for (const diagnostic of assembled.diagnostics) note(diagnostic.code, diagnostic.message);
  const definitionStepForest = assembled.forest;
  const statements = definitionStepForest
    ? definitionStepForest.stepOrder.map((stepId) => coreElement(definitionStepForest.steps[stepId].core))
    : listChildren(container);

  return {
    form,
    container,
    fqn: idOf(container),
    statements,
    definitionStepForest,
    facets,
    dir,
    diagnostics,
  };
}

function coreElement(core) {
  const sectionEntries = Object.entries(core.sections).map(([tag, child]) => [tag, coreElement(child)]);
  return {
    kind: 'DataElement',
    tag: core.tag,
    id: core.id ? word(core.id) : undefined,
    metadata: { ...core.metadata },
    attributes: { ...core.attrs },
    body: core.children.map(coreElement),
    extend: sectionEntries.length > 0 ? {
      order: sectionEntries.map(([tag]) => tag),
      children: Object.fromEntries(sectionEntries),
    } : undefined,
  };
}

function word(value) {
  const parts = value.split('.');
  return { kind: 'Word', namespace: parts.slice(0, -1), name: parts.at(-1) };
}
