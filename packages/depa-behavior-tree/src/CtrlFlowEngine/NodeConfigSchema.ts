import { CtrlFlowNodeType } from './types';

type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonSchemaDefinition {
  type?: JsonSchemaType;
  enum?: readonly unknown[];
  required?: readonly string[];
  properties?: Record<string, JsonSchemaDefinition>;
  additionalProperties?: boolean | JsonSchemaDefinition;
  items?: JsonSchemaDefinition;
  minimum?: number;
  minLength?: number;
}

export interface CtrlFlowSchemaIssue {
  code: string;
  path: string;
  message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateAgainstSchema(
  schema: JsonSchemaDefinition,
  value: unknown,
  path: string,
  issues: CtrlFlowSchemaIssue[]
): void {
  if (schema.type) {
    switch (schema.type) {
      case 'object':
        if (!isPlainObject(value)) {
          issues.push({
            code: 'TYPE_MISMATCH',
            path,
            message: 'Expected object value.',
          });
          return;
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          issues.push({
            code: 'TYPE_MISMATCH',
            path,
            message: 'Expected array value.',
          });
          return;
        }
        break;
      case 'string':
        if (typeof value !== 'string') {
          issues.push({
            code: 'TYPE_MISMATCH',
            path,
            message: 'Expected string value.',
          });
          return;
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          issues.push({
            code: 'TYPE_MISMATCH',
            path,
            message: 'Expected number value.',
          });
          return;
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          issues.push({
            code: 'TYPE_MISMATCH',
            path,
            message: 'Expected boolean value.',
          });
          return;
        }
        break;
      case 'null':
        if (value !== null) {
          issues.push({
            code: 'TYPE_MISMATCH',
            path,
            message: 'Expected null value.',
          });
          return;
        }
        break;
      default:
        break;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    issues.push({
      code: 'ENUM_MISMATCH',
      path,
      message: `Expected one of: ${schema.enum.map(String).join(', ')}.`,
    });
  }

  if (schema.type === 'string' && typeof value === 'string' && schema.minLength !== undefined) {
    if (value.length < schema.minLength) {
      issues.push({
        code: 'STRING_TOO_SHORT',
        path,
        message: `Expected length >= ${schema.minLength}.`,
      });
    }
  }

  if (schema.type === 'number' && typeof value === 'number' && schema.minimum !== undefined) {
    if (value < schema.minimum) {
      issues.push({
        code: 'NUMBER_TOO_SMALL',
        path,
        message: `Expected number >= ${schema.minimum}.`,
      });
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      validateAgainstSchema(schema.items as JsonSchemaDefinition, item, `${path}[${index}]`, issues);
    });
  }

  if (schema.type === 'object' && isPlainObject(value)) {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];

    required.forEach((requiredKey) => {
      if (!(requiredKey in value)) {
        issues.push({
          code: 'MISSING_REQUIRED',
          path: `${path}.${requiredKey}`,
          message: 'Required property is missing.',
        });
      }
    });

    Object.keys(value).forEach((key) => {
      if (key in properties) {
        validateAgainstSchema(properties[key], value[key], `${path}.${key}`, issues);
        return;
      }

      if (schema.additionalProperties === false) {
        issues.push({
          code: 'UNKNOWN_PROPERTY',
          path: `${path}.${key}`,
          message: 'Additional properties are not allowed.',
        });
        return;
      }

      if (schema.additionalProperties && schema.additionalProperties !== true) {
        validateAgainstSchema(
          schema.additionalProperties as JsonSchemaDefinition,
          value[key],
          `${path}.${key}`,
          issues
        );
      }
    });
  }
}

const EMPTY_OBJECT_SCHEMA: JsonSchemaDefinition = {
  type: 'object',
  additionalProperties: false,
};

const EXPRESSION_SCHEMA: JsonSchemaDefinition = {
  type: 'object',
  required: ['expression'],
  additionalProperties: false,
  properties: {
    expression: { type: 'string', minLength: 1 },
  },
};

// ---------------------------------------------------------------------------
// Extensible schema registry
// ---------------------------------------------------------------------------

const schemaRegistry = new Map<string, JsonSchemaDefinition>();

/**
 * Register a config schema for a node type.
 * Extensions call this to add validation for custom node types.
 */
export function registerNodeConfigSchema(
  nodeType: string,
  schema: JsonSchemaDefinition
): void {
  schemaRegistry.set(nodeType, schema);
}

/**
 * Get the config schema for a node type.
 * Returns undefined if no schema is registered.
 */
export function getNodeConfigSchema(
  nodeType: string
): JsonSchemaDefinition | undefined {
  return schemaRegistry.get(nodeType);
}

// ---------------------------------------------------------------------------
// Core schemas (pre-registered)
// ---------------------------------------------------------------------------

registerNodeConfigSchema(CtrlFlowNodeType.Sequence, EMPTY_OBJECT_SCHEMA);
registerNodeConfigSchema(CtrlFlowNodeType.Selector, EMPTY_OBJECT_SCHEMA);
registerNodeConfigSchema(CtrlFlowNodeType.Condition, EXPRESSION_SCHEMA);
registerNodeConfigSchema(CtrlFlowNodeType.Until, EXPRESSION_SCHEMA);
registerNodeConfigSchema(CtrlFlowNodeType.CheckExpression, EXPRESSION_SCHEMA);
registerNodeConfigSchema(CtrlFlowNodeType.CheckVariable, {
  type: 'object',
  required: ['variableName'],
  additionalProperties: false,
  properties: {
    variableName: { type: 'string', minLength: 1 },
    expectedValue: {},
    operator: {
      type: 'string',
      enum: ['equals', 'notEquals', 'greaterThan', 'lessThan', 'exists', 'notExists'],
    },
  },
});
registerNodeConfigSchema(CtrlFlowNodeType.SetVariable, {
  type: 'object',
  required: ['variableName'],
  additionalProperties: false,
  properties: {
    variableName: { type: 'string', minLength: 1 },
    value: {},
  },
});
registerNodeConfigSchema(CtrlFlowNodeType.Log, {
  type: 'object',
  required: ['message'],
  additionalProperties: false,
  properties: {
    message: { type: 'string' },
    level: { type: 'string', enum: ['info', 'warn', 'error', 'debug'] },
  },
});
registerNodeConfigSchema(CtrlFlowNodeType.Assert, {
  type: 'object',
  required: ['expression'],
  additionalProperties: false,
  properties: {
    expression: { type: 'string', minLength: 1 },
    errorMessage: { type: 'string' },
    logOnFailure: { type: 'boolean' },
  },
});
registerNodeConfigSchema(CtrlFlowNodeType.Sleep, {
  type: 'object',
  required: ['duration'],
  additionalProperties: false,
  properties: {
    duration: { type: 'number', minimum: 0 },
  },
});
registerNodeConfigSchema(CtrlFlowNodeType.RunScript, {
  type: 'object',
  required: ['script'],
  additionalProperties: false,
  properties: {
    script: { type: 'string' },
  },
});
registerNodeConfigSchema(CtrlFlowNodeType.HttpCall, {
  type: 'object',
  required: ['url', 'method'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', minLength: 1 },
    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
    headers: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    body: {},
    saveResponseTo: { type: 'string', minLength: 1 },
  },
});

// ---------------------------------------------------------------------------
// Backward-compatible record view (read-only proxy over the registry)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use getNodeConfigSchema() / registerNodeConfigSchema() instead.
 * This object is kept for backward compatibility and delegates to the registry.
 */
export const CTRL_FLOW_NODE_CONFIG_SCHEMAS: Record<string, JsonSchemaDefinition> = new Proxy(
  {} as Record<string, JsonSchemaDefinition>,
  {
    get(_target, prop) {
      if (typeof prop === 'string') {
        return schemaRegistry.get(prop);
      }
      return undefined;
    },
    set(_target, prop, value) {
      if (typeof prop === 'string') {
        schemaRegistry.set(prop, value as JsonSchemaDefinition);
        return true;
      }
      return false;
    },
    has(_target, prop) {
      if (typeof prop === 'string') {
        return schemaRegistry.has(prop);
      }
      return false;
    },
  }
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateNodeConfig(
  nodeType: CtrlFlowNodeType,
  config: unknown,
  path = 'config'
): CtrlFlowSchemaIssue[] {
  const issues: CtrlFlowSchemaIssue[] = [];
  const schema = schemaRegistry.get(nodeType);
  if (!schema) {
    // No schema registered – skip validation (extension nodes may not have schemas)
    return issues;
  }
  validateAgainstSchema(schema, config, path, issues);
  return issues;
}
