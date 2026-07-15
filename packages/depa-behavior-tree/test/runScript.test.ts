/**
 * RunScript Action Tests
 *
 * Tests the RunScript action node
 * - Execute JavaScript code
 * - Modify variables through scripts
 * - Complex calculations
 * - Script error handling
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('RunScript Action', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Basic Script Execution', () => {
    it('should execute simple assignment', async () => {
      // Arrange: Create tree with script that sets variable
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 0),
        CtrlFlowDsl.runScript('x = 10')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variable was set by script
      expect(result.success).toBe(true);
      expect(result.variables.x).toBe(10);
    });

    it('should execute arithmetic operations', async () => {
      // Arrange: Create tree with arithmetic script
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', 5),
        CtrlFlowDsl.setVariable('b', 3),
        CtrlFlowDsl.runScript('result = a + b')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify calculation
      expect(result.success).toBe(true);
      expect(result.variables.result).toBe(8);
    });

    it('should execute string operations', async () => {
      // Arrange: Create tree with string manipulation
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('first', 'Hello'),
        CtrlFlowDsl.setVariable('second', 'World'),
        CtrlFlowDsl.runScript('greeting = first + " " + second')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify string concatenation
      expect(result.success).toBe(true);
      expect(result.variables.greeting).toBe('Hello World');
    });

    it('should execute boolean operations', async () => {
      // Arrange: Create tree with boolean logic
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('isActive', true),
        CtrlFlowDsl.setVariable('isEnabled', false),
        CtrlFlowDsl.runScript('canProceed = isActive && !isEnabled')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify boolean result
      expect(result.success).toBe(true);
      expect(result.variables.canProceed).toBe(true);
    });
  });

  describe('Variable Manipulation', () => {
    it('should modify existing variables', async () => {
      // Arrange: Create tree that modifies variable
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('counter', 0),
        CtrlFlowDsl.runScript('counter = counter + 1'),
        CtrlFlowDsl.runScript('counter = counter + 1'),
        CtrlFlowDsl.runScript('counter = counter + 1')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify counter incremented
      expect(result.success).toBe(true);
      expect(result.variables.counter).toBe(3);
    });

    it('should create new variables', async () => {
      // Arrange: Create tree that creates variable in script
      const tree = CtrlFlowDsl.runScript('newVar = "created in script"');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify new variable created
      expect(result.success).toBe(true);
      expect(result.variables.newVar).toBe('created in script');
    });

    it('should handle multiple variable assignments', async () => {
      // Arrange: Create tree with multi-variable script
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 1),
        CtrlFlowDsl.runScript('y = x + 1; z = y + 1')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all variables set
      expect(result.success).toBe(true);
      expect(result.variables.y).toBe(2);
      expect(result.variables.z).toBe(3);
    });

    it('should handle variable type changes', async () => {
      // Arrange: Create tree that changes variable type
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('dynamic', 'string'),
        CtrlFlowDsl.runScript('dynamic = 123'),
        CtrlFlowDsl.runScript('dynamic = true')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify type changed
      expect(result.success).toBe(true);
      expect(result.variables.dynamic).toBe(true);
    });
  });

  describe('Complex Calculations', () => {
    it('should execute mathematical formulas', async () => {
      // Arrange: Create tree with complex math
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', 10),
        CtrlFlowDsl.setVariable('b', 5),
        CtrlFlowDsl.setVariable('c', 2),
        CtrlFlowDsl.runScript('result = (a + b) * c - 5')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify calculation (10+5)*2-5 = 25
      expect(result.success).toBe(true);
      expect(result.variables.result).toBe(25);
    });

    it('should handle division and modulo', async () => {
      // Arrange: Create tree with division operations
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('num', 17),
        CtrlFlowDsl.runScript('quotient = Math.floor(num / 5)'),
        CtrlFlowDsl.runScript('remainder = num % 5')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify division results
      expect(result.success).toBe(true);
      expect(result.variables.quotient).toBe(3);
      expect(result.variables.remainder).toBe(2);
    });

    it('should use Math functions', async () => {
      // Arrange: Create tree using Math library
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 16),
        CtrlFlowDsl.runScript('sqrt = Math.sqrt(x)'),
        CtrlFlowDsl.runScript('max = Math.max(10, 20, 5)')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify Math functions worked
      expect(result.success).toBe(true);
      expect(result.variables.sqrt).toBe(4);
      expect(result.variables.max).toBe(20);
    });

    it('should handle floating point arithmetic', async () => {
      // Arrange: Create tree with float calculations
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('price', 19.99),
        CtrlFlowDsl.setVariable('quantity', 3),
        CtrlFlowDsl.runScript('total = price * quantity'),
        CtrlFlowDsl.runScript('rounded = Math.round(total * 100) / 100')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify float arithmetic
      expect(result.success).toBe(true);
      expect(result.variables.rounded).toBeCloseTo(59.97, 2);
    });
  });

  describe('Array Operations', () => {
    it('should manipulate arrays', async () => {
      // Arrange: Create tree with array operations
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('arr', [1, 2, 3]),
        CtrlFlowDsl.runScript('arr.push(4)'),
        CtrlFlowDsl.runScript('length = arr.length')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify array manipulation
      expect(result.success).toBe(true);
      expect(result.variables.arr).toEqual([1, 2, 3, 4]);
      expect(result.variables.length).toBe(4);
    });

    it('should access array elements', async () => {
      // Arrange: Create tree accessing array elements
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('items', [10, 20, 30]),
        CtrlFlowDsl.runScript('first = items[0]'),
        CtrlFlowDsl.runScript('last = items[items.length - 1]')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify array access
      expect(result.success).toBe(true);
      expect(result.variables.first).toBe(10);
      expect(result.variables.last).toBe(30);
    });

    it('should use array methods', async () => {
      // Arrange: Create tree using array methods
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('numbers', [1, 2, 3, 4, 5]),
        CtrlFlowDsl.runScript('sum = numbers.reduce((a, b) => a + b, 0)'),
        CtrlFlowDsl.runScript('doubled = numbers.map(x => x * 2)')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify array methods
      expect(result.success).toBe(true);
      expect(result.variables.sum).toBe(15);
      expect(result.variables.doubled).toEqual([2, 4, 6, 8, 10]);
    });
  });

  describe('Object Operations', () => {
    it('should manipulate objects', async () => {
      // Arrange: Create tree with object operations
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('user', { name: 'John', age: 30 }),
        CtrlFlowDsl.runScript('user.email = "john@example.com"'),
        CtrlFlowDsl.runScript('user.age = user.age + 1')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify object manipulation
      expect(result.success).toBe(true);
      expect(result.variables.user.name).toBe('John');
      expect(result.variables.user.age).toBe(31);
      expect(result.variables.user.email).toBe('john@example.com');
    });

    it('should access nested properties', async () => {
      // Arrange: Create tree with nested object access
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('data', {
          user: { profile: { name: 'Alice' } },
        }),
        CtrlFlowDsl.runScript('name = data.user.profile.name'),
        CtrlFlowDsl.runScript('data.user.profile.age = 25')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify nested access
      expect(result.success).toBe(true);
      expect(result.variables.name).toBe('Alice');
      expect(result.variables.data.user.profile.age).toBe(25);
    });

    it('should use Object methods', async () => {
      // Arrange: Create tree using Object methods
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('obj', { a: 1, b: 2, c: 3 }),
        CtrlFlowDsl.runScript('keys = Object.keys(obj)'),
        CtrlFlowDsl.runScript('values = Object.values(obj)')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify Object methods
      expect(result.success).toBe(true);
      expect(result.variables.keys).toEqual(['a', 'b', 'c']);
      expect(result.variables.values).toEqual([1, 2, 3]);
    });
  });

  describe('String Operations', () => {
    it('should manipulate strings', async () => {
      // Arrange: Create tree with string operations
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('text', 'Hello World'),
        CtrlFlowDsl.runScript('upper = text.toUpperCase()'),
        CtrlFlowDsl.runScript('lower = text.toLowerCase()'),
        CtrlFlowDsl.runScript('length = text.length')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify string operations
      expect(result.success).toBe(true);
      expect(result.variables.upper).toBe('HELLO WORLD');
      expect(result.variables.lower).toBe('hello world');
      expect(result.variables.length).toBe(11);
    });

    it('should split and join strings', async () => {
      // Arrange: Create tree with split/join
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('csv', 'a,b,c,d'),
        CtrlFlowDsl.runScript('parts = csv.split(",")'),
        CtrlFlowDsl.runScript('rejoined = parts.join("-")')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify split/join
      expect(result.success).toBe(true);
      expect(result.variables.parts).toEqual(['a', 'b', 'c', 'd']);
      expect(result.variables.rejoined).toBe('a-b-c-d');
    });

    it('should use string methods', async () => {
      // Arrange: Create tree with string methods
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('str', '  Hello World  '),
        CtrlFlowDsl.runScript('trimmed = str.trim()'),
        CtrlFlowDsl.runScript('contains = str.includes("World")'),
        CtrlFlowDsl.runScript('starts = str.trim().startsWith("Hello")')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify string methods
      expect(result.success).toBe(true);
      expect(result.variables.trimmed).toBe('Hello World');
      expect(result.variables.contains).toBe(true);
      expect(result.variables.starts).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with conditions', async () => {
      // Arrange: Create tree using script with conditions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('score', 85),
        CtrlFlowDsl.runScript('grade = score >= 90 ? "A" : score >= 80 ? "B" : "C"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify conditional logic
      expect(result.success).toBe(true);
      expect(result.variables.grade).toBe('B');
    });

    it('should work in loops', async () => {
      // Arrange: Create loop using script
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('sum', 0),
        CtrlFlowDsl.setVariable('i', 1),
        CtrlFlowDsl.until(
          'i > 5',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('sum = sum + i'),
            CtrlFlowDsl.runScript('i = i + 1')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify loop calculations (1+2+3+4+5 = 15)
      expect(result.success).toBe(true);
      expect(result.variables.sum).toBe(15);
      expect(result.variables.i).toBe(6);
    });

    it('should implement counter pattern', async () => {
      // Arrange: Create counter pattern
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('count', 0),
        CtrlFlowDsl.runScript('count++'),
        CtrlFlowDsl.runScript('count++'),
        CtrlFlowDsl.runScript('count++')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify counter
      expect(result.success).toBe(true);
      expect(result.variables.count).toBe(3);
    });

    it('should implement accumulator pattern', async () => {
      // Arrange: Create accumulator pattern
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('items', [10, 20, 30]),
        CtrlFlowDsl.setVariable('total', 0),
        CtrlFlowDsl.setVariable('index', 0),
        CtrlFlowDsl.until(
          'index >= items.length',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('total += items[index]'),
            CtrlFlowDsl.runScript('index++')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify accumulation
      expect(result.success).toBe(true);
      expect(result.variables.total).toBe(60);
    });

    it('should implement data transformation', async () => {
      // Arrange: Create data transformation pipeline
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('rawData', [
          { name: 'John', score: 85 },
          { name: 'Jane', score: 92 },
        ]),
        CtrlFlowDsl.runScript('names = rawData.map(item => item.name)'),
        CtrlFlowDsl.runScript('avgScore = rawData.reduce((sum, item) => sum + item.score, 0) / rawData.length')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify transformation
      expect(result.success).toBe(true);
      expect(result.variables.names).toEqual(['John', 'Jane']);
      expect(result.variables.avgScore).toBe(88.5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty script', async () => {
      // Arrange: Create tree with empty script
      const tree = CtrlFlowDsl.runScript('');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Empty script should succeed
      expect(result.success).toBe(true);
    });

    it('should handle script with only comments', async () => {
      // Arrange: Create tree with comment-only script
      const tree = CtrlFlowDsl.runScript('// This is a comment');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Comment-only script should succeed
      expect(result.success).toBe(true);
    });

    it('should handle undefined variables gracefully', async () => {
      // Arrange: Create tree accessing undefined variable
      const tree = CtrlFlowDsl.runScript('result = typeof undefinedVar');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Should handle gracefully
      expect(result.success).toBe(true);
      expect(result.variables.result).toBe('undefined');
    });

    it('should handle null values', async () => {
      // Arrange: Create tree with null handling
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('value', null),
        CtrlFlowDsl.runScript('isNull = value === null'),
        CtrlFlowDsl.runScript('value = value || "default"')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify null handling
      expect(result.success).toBe(true);
      expect(result.variables.isNull).toBe(true);
      expect(result.variables.value).toBe('default');
    });
  });
});
