import { describe, expect, test } from 'bun:test';
import { loadCtrlFlowProfileFromSources } from '../../instant-ctrl-flow-logic/src/index.js';
import { loadEagerDataFlowProfileSources } from '../../eager-data-flow-logic/src/index.js';

const ctrlInline = {
  'manifest.xnl': `<AICtrlWorkflow #example.Ctrl apiVersion="depa.flows/v1" version="1" (
    <FlowContract #example.Ctrl { input = "vfs://./types.ts#Input" output = "vfs://./types.ts#Output" }>
  ) [
    <Run #work { src = "vfs://./flow-code/work.ts#run" }>
    <Return #done>
  ]>`,
};

const ctrlModular = {
  'manifest.xnl': `<AICtrlWorkflow #example.Ctrl apiVersion="depa.flows/v1" version="1" (
    <FlowContract #example.Ctrl { input = "vfs://./types.ts#Input" output = "vfs://./types.ts#Output" }>
    <StepSpaceRef { src = "step-space.xnl" }>
  )>`,
  'step-space.xnl': `<StepSpace #example.CtrlSteps [
    <StepRef #work { src = "steps/work.xnl" }>
    <StepRef #done { src = "steps/done.xnl" }>
  ]>`,
  'steps/work.xnl': `<Step #work ( <Core [ <Run #work { src = "vfs://./flow-code/work.ts#run" }> ]> )>`,
  'steps/done.xnl': `<Step #done ( <Core [ <Return #done> ]> )>`,
};

const dataInline = {
  'manifest.xnl': `<AIDataWorkflow #example.Data apiVersion="depa.flows/v1" version="1" (
    <FlowContract #example.Data { inputPorts = ["request"] outputPorts = ["result"] }>
  ) [
    <EntryNode #entry>
    <TransformNode #work { inputs = { request = "flow-port://#entry/request" } outputs = ["result"] src = "vfs://./flow-code/work.ts#run" }>
    <ReturnNode #done { inputs = { result = "flow-port://#work/result" } }>
  ]>`,
};

const dataModular = {
  'manifest.xnl': `<AIDataWorkflow #example.Data apiVersion="depa.flows/v1" version="1" (
    <FlowContract #example.Data { inputPorts = ["request"] outputPorts = ["result"] }>
    <StepSpaceRef { src = "step-space.xnl" }>
  )>`,
  'step-space.xnl': `<StepSpace #example.DataSteps [
    <StepRef #entry { src = "steps/entry.xnl" }>
    <StepRef #work { src = "steps/work.xnl" }>
    <StepRef #done { src = "steps/done.xnl" }>
  ]>`,
  'steps/entry.xnl': `<Step #entry ( <Core [ <EntryNode #entry> ]> )>`,
  'steps/work.xnl': `<Step #work ( <Core [ <TransformNode #work { inputs = { request = "flow-port://#entry/request" } outputs = ["result"] src = "vfs://./flow-code/work.ts#run" }> ]> )>`,
  'steps/done.xnl': `<Step #done ( <Core [ <ReturnNode #done { inputs = { result = "flow-port://#work/result" } }> ]> )>`,
};

describe('StepSpace profile assembly', () => {
  test('maps Ctrl hierarchy into the existing canonical statements', () => {
    const inline = loadCtrlFlowProfileFromSources(ctrlInline, {
      profileRoot: 'AICtrlWorkflow', substrateForm: 'WorkCtrlFlow',
    });
    const modular = loadCtrlFlowProfileFromSources(ctrlModular, {
      profileRoot: 'AICtrlWorkflow', substrateForm: 'WorkCtrlFlow',
    });
    expect(modular.diagnostics).toEqual([]);
    expect(modular.spec?.statements).toEqual(inline.spec?.statements);
    expect(modular.spec?.definitionStepForest?.stepOrder).toEqual(['work', 'done']);
  });

  test('maps Data core dependency and port facts into the existing canonical plan', () => {
    const inline = loadEagerDataFlowProfileSources(dataInline, { profileRoot: 'AIDataWorkflow' });
    const modular = loadEagerDataFlowProfileSources(dataModular, { profileRoot: 'AIDataWorkflow' });
    expect(modular.diagnostics).toEqual([]);
    expect(modular.plan?.nodes).toEqual(inline.plan?.nodes);
    expect(modular.plan?.dataEdges).toEqual(inline.plan?.dataEdges);
    expect(modular.plan?.definitionStepForest?.stepOrder).toEqual(['entry', 'work', 'done']);
  });

  test('rejects inline executable nodes plus StepSpaceRef before profile admission', () => {
    const loaded = loadCtrlFlowProfileFromSources({
      ...ctrlModular,
      'manifest.xnl': ctrlModular['manifest.xnl'].replace(')>', ')[ <Return #inline> ]>'),
    }, { profileRoot: 'AICtrlWorkflow', substrateForm: 'WorkCtrlFlow' });
    expect(loaded.spec).toBeUndefined();
    expect(loaded.diagnostics.map((item) => item.code)).toContain('step-topology-authority-conflict');
  });
});
