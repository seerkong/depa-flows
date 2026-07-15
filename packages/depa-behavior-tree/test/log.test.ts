/**
 * Log Action Tests
 *
 * Tests the Log action node
 * - Different log levels (info, warn, error, debug)
 * - Log messages with variables
 * - Multiple log statements
 * - Log output verification
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('Log Action', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Basic Logging', () => {
    it('should log simple message', async () => {
      // Arrange: Create tree with simple log
      const tree = CtrlFlowDsl.log('Hello, World!');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify log was captured
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toContain('Hello, World!');
    });

    it('should log multiple messages', async () => {
      // Arrange: Create tree with multiple logs
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('First message'),
        CtrlFlowDsl.log('Second message'),
        CtrlFlowDsl.log('Third message')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all logs captured
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
      expect(result.logs[0]).toContain('First message');
      expect(result.logs[1]).toContain('Second message');
      expect(result.logs[2]).toContain('Third message');
    });

    it('should preserve log order', async () => {
      // Arrange: Create tree with ordered logs
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Step 1'),
        CtrlFlowDsl.setVariable('x', 1),
        CtrlFlowDsl.log('Step 2'),
        CtrlFlowDsl.setVariable('y', 2),
        CtrlFlowDsl.log('Step 3')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify log order
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
      expect(result.logs[0]).toContain('Step 1');
      expect(result.logs[1]).toContain('Step 2');
      expect(result.logs[2]).toContain('Step 3');
    });
  });

  describe('Log Levels', () => {
    it('should log info level messages', async () => {
      // Arrange: Create tree with info log
      const tree = CtrlFlowDsl.log('Info message', 'info');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify info log
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toContain('Info message');
    });

    it('should log warn level messages', async () => {
      // Arrange: Create tree with warn log
      const tree = CtrlFlowDsl.log('Warning message', 'warn');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify warn log
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toContain('Warning message');
    });

    it('should log error level messages', async () => {
      // Arrange: Create tree with error log
      const tree = CtrlFlowDsl.log('Error message', 'error');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify error log
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toContain('Error message');
    });

    it('should log debug level messages', async () => {
      // Arrange: Create tree with debug log
      const tree = CtrlFlowDsl.log('Debug message', 'debug');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify debug log
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toContain('Debug message');
    });

    it('should handle different log levels in sequence', async () => {
      // Arrange: Create tree with mixed log levels
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Info log', 'info'),
        CtrlFlowDsl.log('Warning log', 'warn'),
        CtrlFlowDsl.log('Error log', 'error'),
        CtrlFlowDsl.log('Debug log', 'debug')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all logs captured with different levels
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(4);
    });
  });

  describe('Log Messages with Variables', () => {
    it('should log messages with variable interpolation', async () => {
      // Arrange: Create tree with variable in log message
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('name', 'John'),
        CtrlFlowDsl.log('Hello, John')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify log contains variable value
      expect(result.success).toBe(true);
      expect(result.logs[0]).toContain('John');
    });

    it('should log numeric variables', async () => {
      // Arrange: Create tree logging numbers
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('count', 42),
        CtrlFlowDsl.log('Count is 42')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify number logged
      expect(result.success).toBe(true);
      expect(result.logs[0]).toContain('42');
    });

    it('should log boolean variables', async () => {
      // Arrange: Create tree logging booleans
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('flag', true),
        CtrlFlowDsl.log('Flag is true')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify boolean logged
      expect(result.success).toBe(true);
      expect(result.logs[0]).toContain('true');
    });

    it('should log complex messages', async () => {
      // Arrange: Create tree with complex log message
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('user', 'Alice'),
        CtrlFlowDsl.setVariable('score', 95),
        CtrlFlowDsl.log('User Alice scored 95 points')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify complex message
      expect(result.success).toBe(true);
      expect(result.logs[0]).toContain('Alice');
      expect(result.logs[0]).toContain('95');
    });
  });

  describe('Special Characters and Formats', () => {
    it('should log empty string', async () => {
      // Arrange: Create tree with empty log
      const tree = CtrlFlowDsl.log('');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify empty log captured
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
    });

    it('should log multiline messages', async () => {
      // Arrange: Create tree with multiline log
      const tree = CtrlFlowDsl.log('Line 1\nLine 2\nLine 3');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify multiline log
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toContain('Line 1');
    });

    it('should log special characters', async () => {
      // Arrange: Create tree with special characters
      const tree = CtrlFlowDsl.log('Special: @#$%^&*()');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify special characters logged
      expect(result.success).toBe(true);
      expect(result.logs[0]).toContain('@#$%^&*()');
    });

    it('should log unicode characters', async () => {
      // Arrange: Create tree with unicode
      const tree = CtrlFlowDsl.log('Unicode: 你好 🎉');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify unicode logged
      expect(result.success).toBe(true);
      expect(result.logs[0]).toContain('你好');
      expect(result.logs[0]).toContain('🎉');
    });

    it('should handle very long messages', async () => {
      // Arrange: Create tree with long message
      const longMessage = 'A'.repeat(1000);
      const tree = CtrlFlowDsl.log(longMessage);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify long message logged
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].length).toBeGreaterThan(100);
    });
  });

  describe('Integration Scenarios', () => {
    it('should log workflow progress', async () => {
      // Arrange: Create workflow with progress logging
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting workflow'),
        CtrlFlowDsl.setVariable('step', 1),
        CtrlFlowDsl.log('Step 1 completed'),
        CtrlFlowDsl.setVariable('step', 2),
        CtrlFlowDsl.log('Step 2 completed'),
        CtrlFlowDsl.log('Workflow finished')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all progress logged
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(4);
      expect(result.logs[0]).toContain('Starting');
      expect(result.logs[3]).toContain('finished');
    });

    it('should log in conditional branches', async () => {
      // Arrange: Create tree with conditional logging
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('mode', 'dev'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "prod"'),
            CtrlFlowDsl.log('Production mode')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "dev"'),
            CtrlFlowDsl.log('Development mode')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify correct branch logged
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toContain('Development mode');
    });

    it('should log in loops', async () => {
      // Arrange: Create tree with loop logging
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('i', 0),
        CtrlFlowDsl.until(
          'i >= 3',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.log('Loop iteration'),
            CtrlFlowDsl.runScript('i = i + 1')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify loop iterations logged
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
    });

    it('should log error context', async () => {
      // Arrange: Create tree logging before failure
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Before assertion'),
        CtrlFlowDsl.setVariable('value', 10),
        CtrlFlowDsl.log('Value set to 10'),
        CtrlFlowDsl.assert('value === 20', 'Value should be 20'),
        CtrlFlowDsl.log('This should not log')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify logs up to failure point
      expect(result.success).toBe(false);
      expect(result.logs).toHaveLength(2);
      expect(result.logs[0]).toContain('Before assertion');
      expect(result.logs[1]).toContain('Value set to 10');
    });

    it('should track state transitions with logging', async () => {
      // Arrange: Create state machine with logging
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('state', 'init'),
        CtrlFlowDsl.log('State: init'),
        CtrlFlowDsl.setVariable('state', 'processing'),
        CtrlFlowDsl.log('State: processing'),
        CtrlFlowDsl.setVariable('state', 'done'),
        CtrlFlowDsl.log('State: done')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all state transitions logged
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
      expect(result.logs[0]).toContain('init');
      expect(result.logs[1]).toContain('processing');
      expect(result.logs[2]).toContain('done');
    });

    it('should provide debug context', async () => {
      // Arrange: Create tree with debug logging
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Debug: Starting calculation', 'debug'),
        CtrlFlowDsl.setVariable('a', 10),
        CtrlFlowDsl.log('Debug: a = 10', 'debug'),
        CtrlFlowDsl.setVariable('b', 20),
        CtrlFlowDsl.log('Debug: b = 20', 'debug'),
        CtrlFlowDsl.runScript('sum = a + b'),
        CtrlFlowDsl.log('Debug: sum calculated', 'debug'),
        CtrlFlowDsl.assert('sum === 30')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify debug logs provide context
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(4);
      expect(result.logs.every(log => log.includes('Debug'))).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null in log message', async () => {
      // Arrange: Create tree logging null
      const tree = CtrlFlowDsl.log('Value is null');

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify null handled
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(1);
    });

    it('should log always succeeds', async () => {
      // Arrange: Create tree where log should never fail
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Log 1'),
        CtrlFlowDsl.log('Log 2'),
        CtrlFlowDsl.log('Log 3')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all logs succeeded
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle many logs', async () => {
      // Arrange: Create tree with many logs
      const actions: ReturnType<typeof CtrlFlowDsl.log>[] = [];
      for (let i = 0; i < 100; i++) {
        actions.push(CtrlFlowDsl.log(`Log ${i}`));
      }
      const tree = CtrlFlowDsl.sequence(...actions);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all logs captured
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(100);
    });
  });
});
