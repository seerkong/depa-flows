/**
 * Sleep Action Tests
 *
 * Tests the Sleep action node
 * - Sleep for specified duration
 * - Verify timing accuracy
 * - Multiple sleep operations
 * - Sleep in workflows
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('Sleep Action', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Basic Sleep', () => {
    it('should sleep for specified duration', async () => {
      // Arrange: Create tree with 100ms sleep
      const tree = CtrlFlowDsl.sleep(100);

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify sleep succeeded and took at least 100ms
      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(90); // Allow 10ms tolerance
    });

    it('should complete successfully after sleep', async () => {
      // Arrange: Create tree with sleep
      const tree = CtrlFlowDsl.sleep(50);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle very short sleep', async () => {
      // Arrange: Create tree with 1ms sleep
      const tree = CtrlFlowDsl.sleep(1);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success
      expect(result.success).toBe(true);
    });

    it('should handle zero duration sleep', async () => {
      // Arrange: Create tree with 0ms sleep
      const tree = CtrlFlowDsl.sleep(0);

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify success (0ms sleep should complete immediately)
      expect(result.success).toBe(true);
    });
  });

  describe('Multiple Sleeps', () => {
    it('should handle multiple sleep operations in sequence', async () => {
      // Arrange: Create tree with multiple sleeps
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.sleep(50)
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify all sleeps completed (should take at least 150ms)
      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(140); // Allow tolerance
    });

    it('should execute actions between sleeps', async () => {
      // Arrange: Create tree with actions between sleeps
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('step', 1),
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.setVariable('step', 2),
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.setVariable('step', 3)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all steps completed
      expect(result.success).toBe(true);
      expect(result.variables.step).toBe(3);
    });
  });

  describe('Timing Accuracy', () => {
    it('should sleep for approximately the correct duration', async () => {
      // Arrange: Create tree with 200ms sleep
      const tree = CtrlFlowDsl.sleep(200);

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify timing is within acceptable range
      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(190); // At least 190ms
      expect(duration).toBeLessThan(250); // But not too long
    });

    it('should accumulate sleep durations correctly', async () => {
      // Arrange: Create tree with cumulative sleeps
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.sleep(100),
        CtrlFlowDsl.sleep(100),
        CtrlFlowDsl.sleep(100)
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify total duration (should be ~300ms)
      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(290);
      expect(duration).toBeLessThan(350);
    });
  });

  describe('Integration Scenarios', () => {
    it('should work in workflow with logging', async () => {
      // Arrange: Create workflow with sleep and logging
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Before sleep'),
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.log('After sleep')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify workflow completed with logs
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(2);
      expect(result.logs[0]).toContain('Before sleep');
      expect(result.logs[1]).toContain('After sleep');
    });

    it('should work with variable operations', async () => {
      // Arrange: Create tree with sleep between variable operations
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('counter', 0),
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.runScript('counter = counter + 1'),
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.runScript('counter = counter + 1')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify variables updated correctly
      expect(result.success).toBe(true);
      expect(result.variables.counter).toBe(2);
    });

    it('should work in loops', async () => {
      // Arrange: Create loop with sleep in each iteration
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('i', 0),
        CtrlFlowDsl.until(
          'i >= 3',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.sleep(30),
            CtrlFlowDsl.runScript('i = i + 1')
          )
        )
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify loop completed with sleeps (should take ~90ms)
      expect(result.success).toBe(true);
      expect(result.variables.i).toBe(3);
      expect(duration).toBeGreaterThanOrEqual(85);
    });

    it('should work in conditional branches', async () => {
      // Arrange: Create tree with sleep in selector
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('mode', 'slow'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "fast"'),
            CtrlFlowDsl.sleep(10)
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "slow"'),
            CtrlFlowDsl.sleep(100)
          )
        )
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify correct branch with sleep executed
      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(90); // Should take ~100ms
    });

    it('should simulate rate limiting', async () => {
      // Arrange: Create tree simulating rate-limited operations
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Request 1'),
        CtrlFlowDsl.sleep(100),
        CtrlFlowDsl.log('Request 2'),
        CtrlFlowDsl.sleep(100),
        CtrlFlowDsl.log('Request 3')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify rate limiting worked
      expect(result.success).toBe(true);
      expect(result.logs).toHaveLength(3);
    });

    it('should simulate polling with retries', async () => {
      // Arrange: Create polling simulation
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('attempts', 0),
        CtrlFlowDsl.setVariable('success', false),
        CtrlFlowDsl.until(
          'success === true || attempts >= 3',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('attempts = attempts + 1'),
            CtrlFlowDsl.log('Polling attempt'),
            CtrlFlowDsl.sleep(50),
            CtrlFlowDsl.selector(
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('attempts >= 2'),
                CtrlFlowDsl.setVariable('success', true)
              ),
              CtrlFlowDsl.log('Not ready yet')
            )
          )
        )
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify polling completed (2 iterations with sleeps)
      expect(result.success).toBe(true);
      expect(result.variables.attempts).toBe(2);
      expect(duration).toBeGreaterThanOrEqual(95); // ~100ms total
    });

    it('should work with timeout simulation', async () => {
      // Arrange: Create timeout simulation
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting operation'),
        CtrlFlowDsl.sleep(100),
        CtrlFlowDsl.setVariable('completed', true),
        CtrlFlowDsl.log('Operation completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify operation completed
      expect(result.success).toBe(true);
      expect(result.variables.completed).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle sleep after assertion failure', async () => {
      // Arrange: Create tree where sleep comes after failed assertion
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.assert('false', 'This fails'),
        CtrlFlowDsl.sleep(100) // Should not execute
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify sleep was not executed (fast failure)
      expect(result.success).toBe(false);
      expect(duration).toBeLessThan(50); // Should fail quickly
    });

    it('should handle sleep in failed selector branch', async () => {
      // Arrange: Create selector where first branch sleeps then fails
      const tree = CtrlFlowDsl.selector(
        CtrlFlowDsl.sequence(
          CtrlFlowDsl.sleep(50),
          CtrlFlowDsl.assert('false')
        ),
        CtrlFlowDsl.setVariable('fallback', true)
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify first branch slept, failed, then fallback succeeded
      expect(result.success).toBe(true);
      expect(result.variables.fallback).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(45);
    });

    it('should handle very long sleep', async () => {
      // Arrange: Create tree with longer sleep
      const tree = CtrlFlowDsl.sleep(500);

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify long sleep completed
      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(490);
    }, 1000); // Increase test timeout

    it('should handle many small sleeps', async () => {
      // Arrange: Create tree with many small sleeps
      const actions: ReturnType<typeof CtrlFlowDsl.sleep>[] = [];
      for (let i = 0; i < 10; i++) {
        actions.push(CtrlFlowDsl.sleep(10));
      }
      const tree = CtrlFlowDsl.sequence(...actions);

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Verify all sleeps completed (should take ~100ms)
      expect(result.success).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(95);
    });
  });

  describe('Performance', () => {
    it('should not significantly impact test duration beyond sleep time', async () => {
      // Arrange: Create tree with operations and sleep
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('a', 1),
        CtrlFlowDsl.setVariable('b', 2),
        CtrlFlowDsl.sleep(100),
        CtrlFlowDsl.setVariable('c', 3)
      );

      // Act: Run the test and measure time
      const startTime = Date.now();
      const result = await engine.runTest(tree);
      const duration = Date.now() - startTime;

      // Assert: Duration should be close to sleep time (not much overhead)
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(150); // Sleep + small overhead
    });
  });
});
