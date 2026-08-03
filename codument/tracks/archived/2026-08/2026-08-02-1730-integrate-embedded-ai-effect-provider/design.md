# Design

## Shape

`ai-workflow-contract` extends the effect contract with:

- `AIWorkflowEffectHandler`
- `AIWorkflowEffectHandlerRegistry`
- `AIWorkflowEmbeddedEffectProvider`
- `AIWorkflowEffectResult`
- `AIWorkflowEffectHandlerResolution`

`ai-workflow-logic` provides:

- `createAIWorkflowEffectHandlerRegistry`
- `createEmbeddedAIWorkflowEffectProvider`
- `AIWorkflowEffectHandlerNotFoundError`

## Operation key

Handlers are registered by operation string. `effectId` remains the invocation/event identity and is not used to resolve code.

## Runtime boundary

The embedded provider receives the complete `AIWorkflowEffectRequest` plus the injected runtime roots. It does not read process cwd or environment variables to discover state locations.

## Failure semantics

Missing handlers throw a stable typed error before any effect is dispatched. Handler failures bubble to the caller without being converted to successful data.
