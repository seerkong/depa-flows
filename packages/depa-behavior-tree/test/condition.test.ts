/**
 * Condition Node Tests
 *
 * Tests the Condition control flow node
 * - Expression evaluates to true -> condition succeeds
 * - Expression evaluates to false -> condition fails
 * - Expression evaluation errors
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('Condition Node', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Success Cases', () => {
    it('should succeed when expression is true', async () => {
      // Arrange: Create a condition with true expression
      const tree = CtrlFlowDsl.condition('true');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should succeed when expression evaluates to truthy value', async () => {
      // Arrange: Create a condition with truthy expression
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('value', 1),
        CtrlFlowDsl.condition('value')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for comparison expressions', async () => {
      // Arrange: Create conditions with various comparisons
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 10),
        CtrlFlowDsl.setVariable('y', 5),
        CtrlFlowDsl.condition('x > y'),
        CtrlFlowDsl.condition('x >= 10'),
        CtrlFlowDsl.condition('y < 10'),
        CtrlFlowDsl.condition('y <= 5')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all conditions passed
      expect(result.success).toBe(true);
    });

    it('should succeed for equality checks', async () => {
      // Arrange: Create conditions with equality checks
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', 5),
        CtrlFlowDsl.setVariable('b', 5),
        CtrlFlowDsl.condition('a === b'),
        CtrlFlowDsl.condition('a == b')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for logical operations', async () => {
      // Arrange: Create conditions with logical operators
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', true),
        CtrlFlowDsl.setVariable('b', false),
        CtrlFlowDsl.condition('a && !b'),
        CtrlFlowDsl.condition('a || b')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for string comparisons', async () => {
      // Arrange: Create conditions with string comparisons
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('name', 'test'),
        CtrlFlowDsl.condition('name === "test"'),
        CtrlFlowDsl.condition('name.length > 0')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should succeed for arithmetic expressions', async () => {
      // Arrange: Create conditions with arithmetic
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 5),
        CtrlFlowDsl.condition('x + 5 === 10'),
        CtrlFlowDsl.condition('x * 2 > 5'),
        CtrlFlowDsl.condition('x - 2 < 5')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });
  });

  describe('Failure Cases', () => {
    it('should fail when expression is false', async () => {
      // Arrange: Create a condition with false expression
      const tree = CtrlFlowDsl.condition('false');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
    });

    it('should fail when expression evaluates to falsy value', async () => {
      // Arrange: Create a condition with falsy expression
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('value', 0),
        CtrlFlowDsl.condition('value')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
    });

    it('should fail for failed comparison', async () => {
      // Arrange: Create conditions that fail
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 5),
        CtrlFlowDsl.setVariable('y', 10),
        CtrlFlowDsl.condition('x > y')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
    });

    it('should fail for inequality checks', async () => {
      // Arrange: Create condition with inequality that fails
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', 5),
        CtrlFlowDsl.setVariable('b', 10),
        CtrlFlowDsl.condition('a === b')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
    });

    it('should fail when variable does not exist', async () => {
      // Arrange: Create condition referencing non-existent variable
      const tree = CtrlFlowDsl.condition('nonExistentVar === true');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure (undefined comparison)
      expect(result.success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined checks', async () => {
      // Arrange: Create conditions checking null/undefined
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('nullVar', null),
        CtrlFlowDsl.condition('nullVar === null'),
        CtrlFlowDsl.condition('typeof undefinedVar === "undefined"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle complex boolean expressions', async () => {
      // Arrange: Create complex boolean conditions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', true),
        CtrlFlowDsl.setVariable('b', false),
        CtrlFlowDsl.setVariable('c', true),
        CtrlFlowDsl.condition('(a && c) || (b && !c)'),
        CtrlFlowDsl.condition('!(a && b)')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle array and object checks', async () => {
      // Arrange: Create conditions with arrays and objects
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('arr', [1, 2, 3]),
        CtrlFlowDsl.setVariable('obj', { key: 'value' }),
        CtrlFlowDsl.condition('arr.length === 3'),
        CtrlFlowDsl.condition('obj.key === "value"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle type checking', async () => {
      // Arrange: Create conditions with type checks
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('str', 'hello'),
        CtrlFlowDsl.setVariable('num', 42),
        CtrlFlowDsl.setVariable('bool', true),
        CtrlFlowDsl.condition('typeof str === "string"'),
        CtrlFlowDsl.condition('typeof num === "number"'),
        CtrlFlowDsl.condition('typeof bool === "boolean"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle syntax errors in expression gracefully', async () => {
      // Arrange: Create condition with invalid syntax
      const tree = CtrlFlowDsl.condition('invalid syntax here ===');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Should fail or handle error
      expect(result.success).toBe(false);
    });

    it('should handle division by zero', async () => {
      // Arrange: Create condition with division by zero
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 10),
        CtrlFlowDsl.setVariable('y', 0),
        CtrlFlowDsl.condition('x / y === Infinity')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify it handles division by zero
      expect(result.success).toBe(true);
    });
  });

  describe('Integration with Control Flow', () => {
    it('should work in sequence', async () => {
      // Arrange: Create sequence with conditions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('state', 'initial'),
        CtrlFlowDsl.condition('state === "initial"'),
        CtrlFlowDsl.setVariable('state', 'processed'),
        CtrlFlowDsl.condition('state === "processed"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should work in selector', async () => {
      // Arrange: Create selector using conditions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('mode', 'dev'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "prod"'),
            CtrlFlowDsl.setVariable('config', 'production')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "dev"'),
            CtrlFlowDsl.setVariable('config', 'development')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify correct branch taken
      expect(result.success).toBe(true);
      expect(result.variables.config).toBe('development');
    });

    it('should break sequence when condition fails', async () => {
      // Arrange: Create sequence with failing condition
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 5),
        CtrlFlowDsl.condition('x > 10'),
        CtrlFlowDsl.setVariable('shouldNotSet', true)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify sequence stopped at condition
      expect(result.success).toBe(false);
      expect(result.variables.shouldNotSet).toBeUndefined();
    });
  });
});
