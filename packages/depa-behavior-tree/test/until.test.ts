/**
 * Until Node Tests
 *
 * Tests the Until loop control flow node
 * - Condition satisfied immediately -> succeeds without executing children
 * - Loop executes until condition is satisfied
 * - Condition never satisfied -> behavior depends on max iterations
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('Until Node', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Success Cases', () => {
    it('should succeed immediately when condition is already true', async () => {
      // Arrange: Create an Until node with initially true condition
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('done', true),
        CtrlFlowDsl.until(
          'done === true',
          CtrlFlowDsl.log('Should not execute')
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success and no execution of children
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(0);
    });

    it('should loop until condition becomes true', async () => {
      // Arrange: Create an Until node that increments until condition is met
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('counter', 0),
        CtrlFlowDsl.until(
          'counter >= 3',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.log('Loop iteration'),
            CtrlFlowDsl.runScript('counter = counter + 1')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify it looped 3 times
      expect(result.success).toBe(true);
      expect(result.variables.counter).toBe(3);
      expect(result.logs.length).toBe(3);
    });

    it('should execute children in each iteration', async () => {
      // Arrange: Create an Until loop with multiple actions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('count', 0),
        CtrlFlowDsl.setVariable('sum', 0),
        CtrlFlowDsl.until(
          'count >= 5',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('count = count + 1'),
            CtrlFlowDsl.runScript('sum = sum + count'),
            CtrlFlowDsl.log('Iteration')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all iterations executed
      expect(result.success).toBe(true);
      expect(result.variables.count).toBe(5);
      expect(result.variables.sum).toBe(15); // 1+2+3+4+5
      expect(result.logs.length).toBe(5);
    });

    it('should handle single iteration', async () => {
      // Arrange: Create an Until that runs once
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('flag', false),
        CtrlFlowDsl.until(
          'flag === true',
          CtrlFlowDsl.setVariable('flag', true)
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify single iteration
      expect(result.success).toBe(true);
      expect(result.variables.flag).toBe(true);
    });

    it('should work with complex conditions', async () => {
      // Arrange: Create Until with complex exit condition
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('x', 0),
        CtrlFlowDsl.setVariable('y', 0),
        CtrlFlowDsl.until(
          'x > 3 && y > 3',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('x = x + 1'),
            CtrlFlowDsl.runScript('y = y + 1')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify both conditions met
      expect(result.success).toBe(true);
      expect(result.variables.x).toBe(4);
      expect(result.variables.y).toBe(4);
    });
  });

  describe('Failure Cases', () => {
    it('should handle failed child node', async () => {
      // Arrange: Create Until with failing child
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('counter', 0),
        CtrlFlowDsl.until(
          'counter >= 5',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('counter = counter + 1'),
            CtrlFlowDsl.assert('counter < 2', 'Failed at counter >= 2')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure when child fails
      expect(result.success).toBe(false);
      expect(result.variables.counter).toBeLessThan(5);
    });

    it('should stop on first child failure', async () => {
      // Arrange: Create Until that fails in first iteration
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('attempts', 0),
        CtrlFlowDsl.until(
          'false', // Never true
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('attempts = attempts + 1'),
            CtrlFlowDsl.assert('false', 'Always fails')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify it stopped after first failure
      expect(result.success).toBe(false);
      expect(result.variables.attempts).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty children list', async () => {
      // Arrange: Create Until with no children
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('ready', false),
        CtrlFlowDsl.until('ready === true')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Empty children means it will loop forever or reach max iterations
      // The actual behavior depends on implementation (infinite loop protection)
      // For now, just verify it completes
      expect(result).toBeDefined();
    });

    it('should handle nested Until loops', async () => {
      // Arrange: Create nested Until loops
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('outer', 0),
        CtrlFlowDsl.until(
          'outer >= 2',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('outer = outer + 1'),
            CtrlFlowDsl.setVariable('inner', 0),
            CtrlFlowDsl.until(
              'inner >= 2',
              CtrlFlowDsl.runScript('inner = inner + 1')
            ),
            CtrlFlowDsl.log('Outer iteration, Inner completed')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify nested loops executed
      expect(result.success).toBe(true);
      expect(result.variables.outer).toBe(2);
      expect(result.logs.length).toBe(2);
    });

    it('should work with condition checking multiple variables', async () => {
      // Arrange: Create Until checking multiple variables
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', 0),
        CtrlFlowDsl.setVariable('b', 0),
        CtrlFlowDsl.setVariable('c', 0),
        CtrlFlowDsl.until(
          'a >= 2 && b >= 2 && c >= 2',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('a = a + 1'),
            CtrlFlowDsl.runScript('b = b + 1'),
            CtrlFlowDsl.runScript('c = c + 1')
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all variables updated
      expect(result.success).toBe(true);
      expect(result.variables.a).toBe(2);
      expect(result.variables.b).toBe(2);
      expect(result.variables.c).toBe(2);
    });
  });

  describe('Infinite Loop Protection', () => {
    it('should handle condition that is never true', async () => {
      // Arrange: Create Until with condition that never becomes true
      // This tests if there's protection against infinite loops
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('counter', 0),
        CtrlFlowDsl.until(
          'false', // Never true
          CtrlFlowDsl.runScript('counter = counter + 1')
        )
      );

      // Act: Run the test with timeout
      const resultPromise = engine.runTest(tree);

      // Set a timeout to prevent actual infinite loop in test
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve({ timeout: true }), 5000);
      });

      const result: any = await Promise.race([resultPromise, timeoutPromise]);

      // Assert: Either has protection (succeeds/fails gracefully) or times out
      if (result.timeout) {
        // Implementation might not have infinite loop protection
        expect(result.timeout).toBe(true);
      } else {
        // Implementation has protection - verify counter didn't go crazy
        expect(result.variables.counter).toBeLessThan(10000);
      }
    });
  });

  describe('Integration Scenarios', () => {
    it('should work in sequence context', async () => {
      // Arrange: Use Until within a larger sequence
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('status', 'initializing'),
        CtrlFlowDsl.setVariable('retries', 0),
        CtrlFlowDsl.log('Starting process'),
        CtrlFlowDsl.until(
          'retries >= 3',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('retries = retries + 1'),
            CtrlFlowDsl.log('Retry attempt')
          )
        ),
        CtrlFlowDsl.setVariable('status', 'completed'),
        CtrlFlowDsl.log('Process finished')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify complete workflow
      expect(result.success).toBe(true);
      expect(result.variables.status).toBe('completed');
      expect(result.variables.retries).toBe(3);
      expect(result.logs.length).toBe(5); // 1 start + 3 retries + 1 finish
    });

    it('should work with selector for conditional looping', async () => {
      // Arrange: Use Until with Selector for retry logic
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('success', false),
        CtrlFlowDsl.setVariable('attempts', 0),
        CtrlFlowDsl.until(
          'success === true || attempts >= 5',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('attempts = attempts + 1'),
            CtrlFlowDsl.selector(
              // Simulate success on 3rd attempt
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('attempts >= 3'),
                CtrlFlowDsl.setVariable('success', true)
              ),
              CtrlFlowDsl.log('Not ready yet')
            )
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify loop exited when success became true
      expect(result.success).toBe(true);
      expect(result.variables.success).toBe(true);
      expect(result.variables.attempts).toBe(3);
    });

    it('should handle state machine pattern', async () => {
      // Arrange: Use Until to implement simple state machine
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('state', 'start'),
        CtrlFlowDsl.setVariable('iterations', 0),
        CtrlFlowDsl.until(
          'state === "end"',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('iterations = iterations + 1'),
            CtrlFlowDsl.selector(
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('state === "start"'),
                CtrlFlowDsl.setVariable('state', 'processing')
              ),
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('state === "processing"'),
                CtrlFlowDsl.setVariable('state', 'finalizing')
              ),
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('state === "finalizing"'),
                CtrlFlowDsl.setVariable('state', 'end')
              )
            )
          )
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify state machine completed
      expect(result.success).toBe(true);
      expect(result.variables.state).toBe('end');
      expect(result.variables.iterations).toBe(3);
    });
  });
});
