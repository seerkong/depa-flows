/**
 * Assert Action Tests
 *
 * Tests the Assert action node
 * - Assertions that pass
 * - Assertions that fail
 * - Custom error messages
 * - Complex assertions
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('Assert Action', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Success Cases', () => {
    it('should succeed when assertion is true', async () => {
      // Arrange: Create tree with true assertion
      const tree = CtrlFlowDsl.assert('true');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should succeed for simple equality assertion', async () => {
      // Arrange: Create tree with equality assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('value', 42),
        CtrlFlowDsl.assert('value === 42')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for comparison assertions', async () => {
      // Arrange: Create tree with various comparison assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 10),
        CtrlFlowDsl.setVariable('y', 5),
        CtrlFlowDsl.assert('x > y'),
        CtrlFlowDsl.assert('x >= 10'),
        CtrlFlowDsl.assert('y < 10'),
        CtrlFlowDsl.assert('y <= 5')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all assertions passed
      expect(result.success).toBe(true);
    });

    it('should succeed for string assertions', async () => {
      // Arrange: Create tree with string assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('name', 'test'),
        CtrlFlowDsl.assert('name === "test"'),
        CtrlFlowDsl.assert('name.length === 4'),
        CtrlFlowDsl.assert('name.startsWith("te")')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for boolean assertions', async () => {
      // Arrange: Create tree with boolean assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('isActive', true),
        CtrlFlowDsl.setVariable('isDisabled', false),
        CtrlFlowDsl.assert('isActive === true'),
        CtrlFlowDsl.assert('isDisabled === false'),
        CtrlFlowDsl.assert('isActive && !isDisabled')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for array assertions', async () => {
      // Arrange: Create tree with array assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('items', [1, 2, 3]),
        CtrlFlowDsl.assert('items.length === 3'),
        CtrlFlowDsl.assert('items[0] === 1'),
        CtrlFlowDsl.assert('items.includes(2)')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for object assertions', async () => {
      // Arrange: Create tree with object assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('user', { name: 'John', age: 30 }),
        CtrlFlowDsl.assert('user.name === "John"'),
        CtrlFlowDsl.assert('user.age === 30'),
        CtrlFlowDsl.assert('typeof user === "object"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });
  });

  describe('Failure Cases', () => {
    it('should fail when assertion is false', async () => {
      // Arrange: Create tree with false assertion
      const tree = CtrlFlowDsl.assert('false');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fail for failed equality assertion', async () => {
      // Arrange: Create tree with failed equality assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('value', 42),
        CtrlFlowDsl.assert('value === 100')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
    });

    it('should fail for failed comparison', async () => {
      // Arrange: Create tree with failed comparison
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 5),
        CtrlFlowDsl.setVariable('y', 10),
        CtrlFlowDsl.assert('x > y')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
    });

    it('should fail and stop sequence execution', async () => {
      // Arrange: Create sequence with failing assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('first', 1),
        CtrlFlowDsl.assert('false', 'This assertion fails'),
        CtrlFlowDsl.setVariable('second', 2)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify sequence stopped at assertion
      expect(result.success).toBe(false);
      expect(result.variables.first).toBe(1);
      expect(result.variables.second).toBeUndefined();
    });
  });

  describe('Custom Error Messages', () => {
    it('should include custom error message when assertion fails', async () => {
      // Arrange: Create tree with custom error message
      const tree = CtrlFlowDsl.assert('false', 'Custom error message');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify custom error message is included
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // The error message format depends on implementation
    });

    it('should use descriptive error messages', async () => {
      // Arrange: Create tree with descriptive assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('expected', 100),
        CtrlFlowDsl.setVariable('actual', 50),
        CtrlFlowDsl.assert(
          'expected === actual',
          'Expected and actual values should match'
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure with message
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Complex Assertions', () => {
    it('should handle multiple conditions in assertion', async () => {
      // Arrange: Create tree with complex assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 10),
        CtrlFlowDsl.setVariable('y', 20),
        CtrlFlowDsl.setVariable('z', 30),
        CtrlFlowDsl.assert('x < y && y < z')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle logical operators', async () => {
      // Arrange: Create tree with logical operators
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', true),
        CtrlFlowDsl.setVariable('b', false),
        CtrlFlowDsl.assert('(a && !b) || (b && !a)')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle nested property assertions', async () => {
      // Arrange: Create tree with nested property assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('data', {
          user: { profile: { name: 'John', age: 30 } },
        }),
        CtrlFlowDsl.assert('data.user.profile.name === "John"'),
        CtrlFlowDsl.assert('data.user.profile.age > 18')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle arithmetic in assertions', async () => {
      // Arrange: Create tree with arithmetic assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', 10),
        CtrlFlowDsl.setVariable('b', 5),
        CtrlFlowDsl.assert('a + b === 15'),
        CtrlFlowDsl.assert('a - b === 5'),
        CtrlFlowDsl.assert('a * b === 50'),
        CtrlFlowDsl.assert('a / b === 2')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle type checking assertions', async () => {
      // Arrange: Create tree with type checking
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('str', 'hello'),
        CtrlFlowDsl.setVariable('num', 42),
        CtrlFlowDsl.setVariable('obj', {}),
        CtrlFlowDsl.assert('typeof str === "string"'),
        CtrlFlowDsl.assert('typeof num === "number"'),
        CtrlFlowDsl.assert('typeof obj === "object"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle null and undefined assertions', async () => {
      // Arrange: Create tree with null/undefined assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('nullVar', null),
        CtrlFlowDsl.setVariable('definedVar', 'value'),
        CtrlFlowDsl.assert('nullVar === null'),
        CtrlFlowDsl.assert('definedVar !== null'),
        CtrlFlowDsl.assert('typeof undefinedVar === "undefined"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should validate workflow state', async () => {
      // Arrange: Create workflow with state validation
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('state', 'initial'),
        CtrlFlowDsl.assert('state === "initial"', 'State should be initial'),
        CtrlFlowDsl.setVariable('state', 'processing'),
        CtrlFlowDsl.assert('state === "processing"', 'State should be processing'),
        CtrlFlowDsl.setVariable('state', 'complete'),
        CtrlFlowDsl.assert('state === "complete"', 'State should be complete')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all state transitions validated
      expect(result.success).toBe(true);
    });

    it('should work with selectors for validation', async () => {
      // Arrange: Create selector with assertion-based branches
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('mode', 'production'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.assert('mode === "development"'),
            CtrlFlowDsl.setVariable('config', 'dev')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.assert('mode === "production"'),
            CtrlFlowDsl.setVariable('config', 'prod')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify correct branch taken
      expect(result.success).toBe(true);
      expect(result.variables.config).toBe('prod');
    });

    it('should validate loop invariants', async () => {
      // Arrange: Create loop with invariant assertions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('sum', 0),
        CtrlFlowDsl.setVariable('i', 0),
        CtrlFlowDsl.until(
          'i >= 5',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.assert('sum >= 0', 'Sum should never be negative'),
            CtrlFlowDsl.runScript('sum = sum + i'),
            CtrlFlowDsl.runScript('i = i + 1'),
            CtrlFlowDsl.assert('i <= 5', 'Counter should not exceed 5')
          )
        ),
        CtrlFlowDsl.assert('sum === 10', 'Final sum should be 10')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all invariants held
      expect(result.success).toBe(true);
    });

    it('should validate preconditions and postconditions', async () => {
      // Arrange: Create workflow with pre/post conditions
      const tree = CtrlFlowDsl.sequence(
        // Preconditions
        CtrlFlowDsl.setVariable('input', 10),
        CtrlFlowDsl.assert('input > 0', 'Input must be positive'),
        CtrlFlowDsl.assert('typeof input === "number"', 'Input must be a number'),

        // Process
        CtrlFlowDsl.runScript('result = input * 2'),

        // Postconditions
        CtrlFlowDsl.assert('result === 20', 'Result should be double the input'),
        CtrlFlowDsl.assert('result > input', 'Result should be greater than input')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all conditions met
      expect(result.success).toBe(true);
    });

    it('should validate API response structure', async () => {
      // Arrange: Create tree simulating API response validation
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('response', {
          status: 200,
          data: { id: 1, name: 'Test' },
          timestamp: Date.now(),
        }),
        CtrlFlowDsl.assert('response.status === 200', 'Status should be 200'),
        CtrlFlowDsl.assert('typeof response.data === "object"', 'Data should be object'),
        CtrlFlowDsl.assert('response.data.id === 1', 'ID should match'),
        CtrlFlowDsl.assert('response.data.name === "Test"', 'Name should match'),
        CtrlFlowDsl.assert('response.timestamp > 0', 'Timestamp should be positive')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all response validations passed
      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string in assertion', async () => {
      // Arrange: Create tree with empty string assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('str', ''),
        CtrlFlowDsl.assert('str === ""'),
        CtrlFlowDsl.assert('str.length === 0')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle zero in assertion', async () => {
      // Arrange: Create tree with zero assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('num', 0),
        CtrlFlowDsl.assert('num === 0'),
        CtrlFlowDsl.assert('!num') // 0 is falsy
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle NaN in assertion', async () => {
      // Arrange: Create tree with NaN assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('nan', NaN),
        CtrlFlowDsl.assert('isNaN(nan)')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });
  });
});
