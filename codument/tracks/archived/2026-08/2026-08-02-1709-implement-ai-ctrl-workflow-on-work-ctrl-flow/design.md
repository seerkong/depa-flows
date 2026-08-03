# Design

## Shape

`ai-ctrl-workflow-contract` defines AI Ctrl Workflow run records and adapter options.

`ai-ctrl-workflow-logic` wraps existing WorkCtrlFlow primitives:

- `createAICtrlWorkflowRuntime` injects `ai` context into WorkCtrlFlow runtime.
- `createAICtrlWorkflowController` constructs a WorkCtrlFlowEngine with expected form `WorkCtrlFlow`.
- `startAICtrlWorkflowRun`, `resumeAICtrlWorkflowRun`, `refreshAICtrlWorkflowRun` and `getAICtrlWorkflowRunRecord` delegate to WorkCtrlFlowEngine and project stored snapshot facts.

## State ownership

WorkCtrlFlow snapshot remains the runtime state owner. AI Ctrl Workflow run record is a projection:

- workflow status from snapshot/outcome;
- open waits from `openWaitHandles`;
- completed nodes from `nodeResults`;
- wait nodes from `waitResults` and `openWaitHandles`;
- tick number from snapshot/outcome.

## Effect boundary

AI effects are supplied through the injected AI runtime context. Adapter logic does not construct provider implementations and does not shell out.

## Validation

Tests start a simple WorkCtrlFlow bundle through the AI Ctrl Workflow controller and verify descriptor binding, runtime injection, snapshot-backed run record and resume projection behavior.
