/**
 * SetVariable Action Tests
 *
 * Tests the SetVariable action node
 * - Set string, number, boolean values
 * - Set complex objects and arrays
 * - Overwrite existing variables
 * - Set multiple variables
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('SetVariable Action', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Basic Types', () => {
    it('should set string variable', async () => {
      // Arrange: Create tree that sets string variable
      const tree = CtrlFlowDsl.setVariable('message', 'Hello, World!');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable is set
      expect(result.success).toBe(true);
      expect(result.variables.message).toBe('Hello, World!');
    });

    it('should set number variable', async () => {
      // Arrange: Create tree that sets number variable
      const tree = CtrlFlowDsl.setVariable('count', 42);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable is set
      expect(result.success).toBe(true);
      expect(result.variables.count).toBe(42);
    });

    it('should set boolean variable', async () => {
      // Arrange: Create tree that sets boolean variable
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('isActive', true),
        CtrlFlowDsl.setVariable('isDisabled', false)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variables are set
      expect(result.success).toBe(true);
      expect(result.variables.isActive).toBe(true);
      expect(result.variables.isDisabled).toBe(false);
    });

    it('should set null value', async () => {
      // Arrange: Create tree that sets null variable
      const tree = CtrlFlowDsl.setVariable('empty', null);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable is set to null
      expect(result.success).toBe(true);
      expect(result.variables.empty).toBeNull();
    });

    it('should set undefined value', async () => {
      // Arrange: Create tree that sets undefined variable
      const tree = CtrlFlowDsl.setVariable('notSet', undefined);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable is set to undefined
      expect(result.success).toBe(true);
      expect(result.variables.notSet).toBeUndefined();
    });

    it('should set zero and empty string', async () => {
      // Arrange: Create tree that sets falsy values
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('zero', 0),
        CtrlFlowDsl.setVariable('emptyString', '')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify falsy values are correctly set
      expect(result.success).toBe(true);
      expect(result.variables.zero).toBe(0);
      expect(result.variables.emptyString).toBe('');
    });
  });

  describe('Complex Types', () => {
    it('should set array variable', async () => {
      // Arrange: Create tree that sets array variable
      const tree = CtrlFlowDsl.setVariable('items', [1, 2, 3, 4, 5]);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify array is set
      expect(result.success).toBe(true);
      expect(result.variables.items).toEqual([1, 2, 3, 4, 5]);
      expect(Array.isArray(result.variables.items)).toBe(true);
    });

    it('should set object variable', async () => {
      // Arrange: Create tree that sets object variable
      const obj = { name: 'Test', value: 123, active: true };
      const tree = CtrlFlowDsl.setVariable('config', obj);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify object is set
      expect(result.success).toBe(true);
      expect(result.variables.config).toEqual(obj);
    });

    it('should set nested object', async () => {
      // Arrange: Create tree that sets nested object
      const nestedObj = {
        user: {
          name: 'John',
          profile: {
            age: 30,
            email: 'john@example.com',
          },
        },
      };
      const tree = CtrlFlowDsl.setVariable('data', nestedObj);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify nested object is set
      expect(result.success).toBe(true);
      expect(result.variables.data).toEqual(nestedObj);
    });

    it('should set mixed array with different types', async () => {
      // Arrange: Create tree that sets mixed array
      const mixedArray = [1, 'two', true, null, { key: 'value' }];
      const tree = CtrlFlowDsl.setVariable('mixed', mixedArray);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify mixed array is set
      expect(result.success).toBe(true);
      expect(result.variables.mixed).toEqual(mixedArray);
    });
  });

  describe('Variable Updates', () => {
    it('should overwrite existing variable', async () => {
      // Arrange: Create tree that sets and overwrites variable
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('value', 'initial'),
        CtrlFlowDsl.setVariable('value', 'updated')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable was overwritten
      expect(result.success).toBe(true);
      expect(result.variables.value).toBe('updated');
    });

    it('should change variable type', async () => {
      // Arrange: Create tree that changes variable type
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('dynamic', 'string'),
        CtrlFlowDsl.setVariable('dynamic', 123),
        CtrlFlowDsl.setVariable('dynamic', true)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable type changed
      expect(result.success).toBe(true);
      expect(result.variables.dynamic).toBe(true);
    });

    it('should update array to object', async () => {
      // Arrange: Create tree that changes variable from array to object
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('data', [1, 2, 3]),
        CtrlFlowDsl.setVariable('data', { key: 'value' })
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable changed from array to object
      expect(result.success).toBe(true);
      expect(result.variables.data).toEqual({ key: 'value' });
    });
  });

  describe('Multiple Variables', () => {
    it('should set multiple variables in sequence', async () => {
      // Arrange: Create tree that sets multiple variables
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('firstName', 'John'),
        CtrlFlowDsl.setVariable('lastName', 'Doe'),
        CtrlFlowDsl.setVariable('age', 30),
        CtrlFlowDsl.setVariable('isActive', true)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all variables are set
      expect(result.success).toBe(true);
      expect(result.variables).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        age: 30,
        isActive: true,
      });
    });

    it('should handle many variables', async () => {
      // Arrange: Create tree that sets many variables
      const actions: ReturnType<typeof CtrlFlowDsl.setVariable>[] = [];
      for (let i = 0; i < 100; i++) {
        actions.push(CtrlFlowDsl.setVariable(`var${i}`, i));
      }
      const tree = CtrlFlowDsl.sequence(...actions);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all 100 variables are set
      expect(result.success).toBe(true);
      expect(Object.keys(result.variables).length).toBe(100);
      expect(result.variables.var0).toBe(0);
      expect(result.variables.var99).toBe(99);
    });
  });

  describe('Special Characters in Names', () => {
    it('should handle variable names with underscores', async () => {
      // Arrange: Create tree with underscore variable names
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('user_name', 'test'),
        CtrlFlowDsl.setVariable('_private', 'value')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variables with underscores work
      expect(result.success).toBe(true);
      expect(result.variables.user_name).toBe('test');
      expect(result.variables._private).toBe('value');
    });

    it('should handle variable names with numbers', async () => {
      // Arrange: Create tree with numeric variable names
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('var1', 'first'),
        CtrlFlowDsl.setVariable('var2test', 'second')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variables with numbers work
      expect(result.success).toBe(true);
      expect(result.variables.var1).toBe('first');
      expect(result.variables.var2test).toBe('second');
    });

    it('should handle camelCase variable names', async () => {
      // Arrange: Create tree with camelCase variable names
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('firstName', 'John'),
        CtrlFlowDsl.setVariable('isActiveUser', true)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify camelCase variables work
      expect(result.success).toBe(true);
      expect(result.variables.firstName).toBe('John');
      expect(result.variables.isActiveUser).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with conditions', async () => {
      // Arrange: Create tree that sets variable and checks it
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('threshold', 100),
        CtrlFlowDsl.condition('threshold === 100'),
        CtrlFlowDsl.setVariable('valid', true)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify integration works
      expect(result.success).toBe(true);
      expect(result.variables.valid).toBe(true);
    });

    it('should work with assertions', async () => {
      // Arrange: Create tree that sets variable and asserts it
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('expected', 'value'),
        CtrlFlowDsl.setVariable('actual', 'value'),
        CtrlFlowDsl.assert('expected === actual', 'Values should match')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify assertion passes
      expect(result.success).toBe(true);
    });

    it('should work in loops', async () => {
      // Arrange: Create tree with variable in loop
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('i', 0),
        CtrlFlowDsl.setVariable('sum', 0),
        CtrlFlowDsl.until(
          'i >= 5',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('sum = sum + i'),
            CtrlFlowDsl.runScript('i = i + 1')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify loop updated variables
      expect(result.success).toBe(true);
      expect(result.variables.i).toBe(5);
      expect(result.variables.sum).toBe(10); // 0+1+2+3+4
    });

    it('should preserve variables across control flow', async () => {
      // Arrange: Create tree with variables across different control nodes
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('global', 'value'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('false'),
            CtrlFlowDsl.setVariable('notSet', true)
          ),
          CtrlFlowDsl.setVariable('inSelector', true)
        ),
        CtrlFlowDsl.condition('global === "value" && inSelector === true')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variables persisted
      expect(result.success).toBe(true);
      expect(result.variables.global).toBe('value');
      expect(result.variables.inSelector).toBe(true);
      expect(result.variables.notSet).toBeUndefined();
    });
  });
});
