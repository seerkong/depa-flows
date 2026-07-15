/**
 * Complex Workflow Integration Tests
 *
 * Tests complex end-to-end workflows combining:
 * - Nested Sequence and Selector nodes
 * - Until loops with complex conditions
 * - Script execution with data transformations
 * - Multi-step processes with validation
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('Complex Workflow Integration', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Nested Control Flow', () => {
    it('should handle deeply nested sequences and selectors', async () => {
      // Arrange: Create deeply nested workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting complex workflow'),
        CtrlFlowDsl.setVariable('level', 1),

        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('level > 5'),
            CtrlFlowDsl.setVariable('branch', 'high')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('level > 2'),
            CtrlFlowDsl.selector(
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('level === 3'),
                CtrlFlowDsl.setVariable('branch', 'medium-3')
              ),
              CtrlFlowDsl.setVariable('branch', 'medium-other')
            )
          ),
          CtrlFlowDsl.setVariable('branch', 'low')
        ),

        CtrlFlowDsl.assert('branch !== undefined', 'Branch should be set'),
        CtrlFlowDsl.log('Workflow completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify nested logic executed correctly
      expect(result.success).toBe(true);
      expect(result.variables.branch).toBe('low');
    });

    it('should handle multiple nested sequences', async () => {
      // Arrange: Create workflow with nested sequences
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('step', 0),

        CtrlFlowDsl.sequence(
          CtrlFlowDsl.runScript('step = step + 1'),
          CtrlFlowDsl.log('Outer sequence - step 1'),

          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('step = step + 1'),
            CtrlFlowDsl.log('Inner sequence - step 2'),

            CtrlFlowDsl.sequence(
              CtrlFlowDsl.runScript('step = step + 1'),
              CtrlFlowDsl.log('Deep sequence - step 3')
            )
          ),

          CtrlFlowDsl.runScript('step = step + 1'),
          CtrlFlowDsl.log('Outer sequence - step 4')
        ),

        CtrlFlowDsl.assert('step === 4', 'All steps should complete')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all nested sequences executed
      expect(result.success).toBe(true);
      expect(result.variables.step).toBe(4);
      expect(result.logs).toHaveLength(4);
    });
  });

  describe('Loop-Based Workflows', () => {
    it('should implement retry mechanism with exponential backoff', async () => {
      // Arrange: Create retry workflow with backoff
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('attempts', 0),
        CtrlFlowDsl.setVariable('maxAttempts', 5),
        CtrlFlowDsl.setVariable('success', false),
        CtrlFlowDsl.setVariable('delay', 10),

        CtrlFlowDsl.until(
          'success === true || attempts >= maxAttempts',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('attempts = attempts + 1'),
            // Literal message; actual attempts value is verified via variables
            CtrlFlowDsl.log('Attempt ${attempts}'),

            // Simulate operation that succeeds on 3rd attempt
            CtrlFlowDsl.selector(
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('attempts >= 3'),
                CtrlFlowDsl.setVariable('success', true),
                CtrlFlowDsl.log('Operation succeeded')
              ),
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.log('Operation failed, retrying'),
                CtrlFlowDsl.sleep(10), // Simulated delay
                CtrlFlowDsl.runScript('delay = delay * 2') // Exponential backoff
              )
            )
          )
        ),

        CtrlFlowDsl.assert('success === true', 'Operation should eventually succeed'),
        // Literal message, avoids referencing a TS variable
        CtrlFlowDsl.log('Completed after ${attempts} attempts')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify retry mechanism
      expect(result.success).toBe(true);
      expect(result.variables.attempts).toBe(3);
      expect(result.variables.success).toBe(true);
    });

    it('should implement polling mechanism', async () => {
      // Arrange: Create polling workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('pollCount', 0),
        CtrlFlowDsl.setVariable('maxPolls', 10),
        CtrlFlowDsl.setVariable('resourceReady', false),

        CtrlFlowDsl.log('Starting to poll for resource'),

        CtrlFlowDsl.until(
          'resourceReady === true || pollCount >= maxPolls',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('pollCount = pollCount + 1'),
            CtrlFlowDsl.sleep(20),

            // Simulate checking resource (ready on 5th poll)
            CtrlFlowDsl.runScript('resourceReady = pollCount >= 5'),

            CtrlFlowDsl.selector(
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('resourceReady === true'),
                CtrlFlowDsl.log('Resource is ready')
              ),
              // Literal message; loop counter is validated via variables
              CtrlFlowDsl.log('Poll ${pollCount}: Resource not ready')
            )
          )
        ),

        CtrlFlowDsl.assert('resourceReady === true', 'Resource should be ready'),
        CtrlFlowDsl.log('Polling completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify polling
      expect(result.success).toBe(true);
      expect(result.variables.resourceReady).toBe(true);
      expect(result.variables.pollCount).toBe(5);
    });

    it('should implement batch processing with loop', async () => {
      // Arrange: Create batch processing workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('items', [
          { id: 1, value: 10 },
          { id: 2, value: 20 },
          { id: 3, value: 30 },
        ]),
        CtrlFlowDsl.setVariable('processedCount', 0),
        CtrlFlowDsl.setVariable('totalValue', 0),
        CtrlFlowDsl.setVariable('index', 0),

        CtrlFlowDsl.log('Starting batch processing'),

        CtrlFlowDsl.until(
          'index >= items.length',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('currentItem = items[index]'),
            CtrlFlowDsl.runScript('totalValue = totalValue + currentItem.value'),
            CtrlFlowDsl.runScript('processedCount = processedCount + 1'),
            // Literal message; currentItem is only used inside scripts
            CtrlFlowDsl.log('Processed item ${currentItem.id}'),
            CtrlFlowDsl.runScript('index = index + 1')
          )
        ),

        CtrlFlowDsl.assert('processedCount === 3', 'Should process all items'),
        CtrlFlowDsl.assert('totalValue === 60', 'Total value should be 60'),
        CtrlFlowDsl.log('Batch processing completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify batch processing
      expect(result.success).toBe(true);
      expect(result.variables.processedCount).toBe(3);
      expect(result.variables.totalValue).toBe(60);
    });
  });

  describe('Data Pipeline Workflows', () => {
    it('should implement multi-stage data pipeline', async () => {
      // Arrange: Create data pipeline
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting data pipeline'),

        // Stage 1: Extract
        CtrlFlowDsl.setVariable('rawData', [
          { name: 'Alice', score: 85, active: true },
          { name: 'Bob', score: 72, active: false },
          { name: 'Charlie', score: 95, active: true },
        ]),
        CtrlFlowDsl.log('Stage 1: Data extracted'),

        // Stage 2: Transform - Filter active users
        CtrlFlowDsl.runScript('activeUsers = rawData.filter(u => u.active)'),
        CtrlFlowDsl.assert('activeUsers.length > 0', 'Should have active users'),
        CtrlFlowDsl.log('Stage 2: Data filtered'),

        // Stage 3: Transform - Calculate average score
        CtrlFlowDsl.runScript('avgScore = activeUsers.reduce((sum, u) => sum + u.score, 0) / activeUsers.length'),
        CtrlFlowDsl.log('Stage 3: Average calculated'),

        // Stage 4: Transform - Create report
        CtrlFlowDsl.runScript('report = { totalUsers: rawData.length, activeUsers: activeUsers.length, avgScore }'),
        CtrlFlowDsl.log('Stage 4: Report created'),

        // Stage 5: Validate
        CtrlFlowDsl.assert('report.activeUsers === 2', 'Should have 2 active users'),
        CtrlFlowDsl.assert('report.avgScore === 90', 'Average score should be 90'),
        CtrlFlowDsl.log('Stage 5: Report validated'),

        CtrlFlowDsl.setVariable('pipelineStatus', 'completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify pipeline
      expect(result.success).toBe(true);
      expect(result.variables.report.activeUsers).toBe(2);
      expect(result.variables.report.avgScore).toBe(90);
      expect(result.variables.pipelineStatus).toBe('completed');
    });

    it('should handle data transformation with validation at each step', async () => {
      // Arrange: Create transformation pipeline with validation
      const tree = CtrlFlowDsl.sequence(
        // Input validation
        CtrlFlowDsl.setVariable('input', { price: 100, tax: 0.08, discount: 0.1 }),
        CtrlFlowDsl.assert('input.price > 0', 'Price must be positive'),
        CtrlFlowDsl.assert('input.tax >= 0', 'Tax must be non-negative'),
        CtrlFlowDsl.assert('input.discount >= 0 && input.discount <= 1', 'Discount must be 0-1'),

        // Step 1: Apply discount
        CtrlFlowDsl.runScript('afterDiscount = input.price * (1 - input.discount)'),
        CtrlFlowDsl.assert('afterDiscount <= input.price', 'Discounted price should be less'),

        // Step 2: Add tax
        CtrlFlowDsl.runScript('finalPrice = afterDiscount * (1 + input.tax)'),
        CtrlFlowDsl.assert('finalPrice > 0', 'Final price must be positive'),

        // Step 3: Round to 2 decimals
        CtrlFlowDsl.runScript('roundedPrice = Math.round(finalPrice * 100) / 100'),

        // Output validation
        CtrlFlowDsl.assert('typeof roundedPrice === "number"', 'Price should be a number'),
        // Store output; actual numeric values are asserted via roundedPrice
        CtrlFlowDsl.setVariable('output', { original: 0, final: 0 })
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify transformation
      expect(result.success).toBe(true);
      expect(result.variables.roundedPrice).toBeCloseTo(97.2, 2);
    });
  });

  describe('State Machine Workflows', () => {
    it('should implement complex state machine', async () => {
      // Arrange: Create state machine workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('state', 'init'),
        CtrlFlowDsl.setVariable('data', null),
        CtrlFlowDsl.setVariable('iterations', 0),
        CtrlFlowDsl.setVariable('maxIterations', 10),

        CtrlFlowDsl.until(
          'state === "complete" || state === "error" || iterations >= maxIterations',
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.runScript('iterations = iterations + 1'),
            // Literal message; state and iterations are validated via variables
            CtrlFlowDsl.log('State: ${state}, Iteration: ${iterations}'),

            CtrlFlowDsl.selector(
              // State: init
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('state === "init"'),
                CtrlFlowDsl.log('Initializing...'),
                CtrlFlowDsl.setVariable('data', { status: 'initializing' }),
                CtrlFlowDsl.setVariable('state', 'loading')
              ),

              // State: loading
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('state === "loading"'),
                CtrlFlowDsl.log('Loading data...'),
                CtrlFlowDsl.runScript('data.status = "loading"'),
                CtrlFlowDsl.runScript('data.loadedAt = Date.now()'),
                CtrlFlowDsl.setVariable('state', 'processing')
              ),

              // State: processing
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('state === "processing"'),
                CtrlFlowDsl.log('Processing data...'),
                CtrlFlowDsl.runScript('data.status = "processing"'),
                CtrlFlowDsl.runScript('data.result = "processed"'),
                CtrlFlowDsl.setVariable('state', 'validating')
              ),

              // State: validating
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('state === "validating"'),
                CtrlFlowDsl.log('Validating...'),
                CtrlFlowDsl.runScript('data.status = "validating"'),
                CtrlFlowDsl.runScript('data.valid = data.result === "processed"'),
                CtrlFlowDsl.selector(
                  CtrlFlowDsl.sequence(
                    CtrlFlowDsl.condition('data.valid === true'),
                    CtrlFlowDsl.setVariable('state', 'complete')
                  ),
                  CtrlFlowDsl.setVariable('state', 'error')
                )
              ),

              // Unknown state
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.log('Unknown state, transitioning to error'),
                CtrlFlowDsl.setVariable('state', 'error')
              )
            )
          )
        ),

        CtrlFlowDsl.assert('state === "complete"', 'State machine should reach complete state'),
        CtrlFlowDsl.log('State machine completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify state machine
      expect(result.success).toBe(true);
      expect(result.variables.state).toBe('complete');
      expect(result.variables.iterations).toBe(4);
      expect(result.variables.data.valid).toBe(true);
    });
  });

  describe('Error Handling Workflows', () => {
    it('should handle errors with multiple fallback strategies', async () => {
      // Arrange: Create error handling workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('attemptStrategy', 1),
        CtrlFlowDsl.setVariable('result', null),

        CtrlFlowDsl.log('Attempting operation with fallback strategies'),

        CtrlFlowDsl.selector(
          // Strategy 1: Primary (will fail)
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.log('Trying strategy 1 (primary)'),
            CtrlFlowDsl.condition('attemptStrategy === 99'), // Always fails
            CtrlFlowDsl.setVariable('result', 'strategy1')
          ),

          // Strategy 2: Secondary (will fail)
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.log('Trying strategy 2 (secondary)'),
            CtrlFlowDsl.runScript('attemptStrategy = 2'),
            CtrlFlowDsl.condition('attemptStrategy === 99'), // Always fails
            CtrlFlowDsl.setVariable('result', 'strategy2')
          ),

          // Strategy 3: Tertiary (will succeed)
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.log('Trying strategy 3 (tertiary)'),
            CtrlFlowDsl.runScript('attemptStrategy = 3'),
            CtrlFlowDsl.setVariable('result', 'strategy3'),
            CtrlFlowDsl.log('Strategy 3 succeeded')
          )
        ),

        CtrlFlowDsl.assert('result !== null', 'Should have a result'),
        // Literal message; actual result is checked in assertions below
        CtrlFlowDsl.log('Completed with ${result}')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify fallback worked
      expect(result.success).toBe(true);
      expect(result.variables.result).toBe('strategy3');
      expect(result.variables.attemptStrategy).toBe(3);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should implement e-commerce checkout workflow', async () => {
      // Arrange: Create checkout workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting checkout process'),

        // Step 1: Validate cart
        CtrlFlowDsl.setVariable('cart', [
          { id: 1, name: 'Product A', price: 29.99, quantity: 2 },
          { id: 2, name: 'Product B', price: 49.99, quantity: 1 },
        ]),
        CtrlFlowDsl.assert('cart.length > 0', 'Cart must not be empty'),

        // Step 2: Calculate totals
        CtrlFlowDsl.runScript('subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)'),
        CtrlFlowDsl.runScript('shipping = subtotal > 50 ? 0 : 9.99'),
        CtrlFlowDsl.runScript('tax = subtotal * 0.08'),
        CtrlFlowDsl.runScript('total = subtotal + shipping + tax'),

        // Step 3: Apply coupon if eligible
        CtrlFlowDsl.setVariable('couponCode', 'SAVE10'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('couponCode === "SAVE10" && subtotal > 50'),
            CtrlFlowDsl.runScript('discount = subtotal * 0.1'),
            CtrlFlowDsl.runScript('total = total - discount'),
            CtrlFlowDsl.log('Coupon applied')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.setVariable('discount', 0),
            CtrlFlowDsl.log('No coupon applied')
          )
        ),

        // Step 4: Validate payment info
        CtrlFlowDsl.setVariable('paymentValid', true),
        CtrlFlowDsl.assert('paymentValid === true', 'Payment must be valid'),

        // Step 5: Create order
        CtrlFlowDsl.runScript('order = { items: cart, subtotal, shipping, tax, discount, total, status: "pending" }'),
        CtrlFlowDsl.setVariable('orderId', 12345),

        // Step 6: Process payment (simulated)
        CtrlFlowDsl.sleep(50),
        CtrlFlowDsl.runScript('order.status = "confirmed"'),
        CtrlFlowDsl.runScript('order.id = orderId'),

        CtrlFlowDsl.log('Checkout completed successfully'),
        CtrlFlowDsl.assert('order.status === "confirmed"', 'Order should be confirmed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify checkout
      expect(result.success).toBe(true);
      expect(result.variables.order.status).toBe('confirmed');
      expect(result.variables.order.total).toBeGreaterThan(0);
      expect(result.variables.discount).toBeGreaterThan(0); // Coupon applied
    });

    it('should implement data sync workflow with conflict resolution', async () => {
      // Arrange: Create data sync workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting data synchronization'),

        // Local and remote data
        CtrlFlowDsl.setVariable('localData', { id: 1, value: 'local', timestamp: 100 }),
        CtrlFlowDsl.setVariable('remoteData', { id: 1, value: 'remote', timestamp: 200 }),

        // Conflict detection
        CtrlFlowDsl.runScript('hasConflict = localData.timestamp !== remoteData.timestamp'),
        // Literal message; hasConflict is only used inside scripts
        CtrlFlowDsl.log('Conflict detected: ${hasConflict}'),

        // Conflict resolution
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('hasConflict === false'),
            // Use localData when there is no conflict
            CtrlFlowDsl.runScript('syncedData = localData'),
            CtrlFlowDsl.log('No conflict, using local data')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('hasConflict === true'),
            CtrlFlowDsl.log('Resolving conflict'),

            // Use most recent based on timestamp
            CtrlFlowDsl.selector(
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.condition('remoteData.timestamp > localData.timestamp'),
                CtrlFlowDsl.runScript('syncedData = remoteData'),
                CtrlFlowDsl.log('Using remote data (more recent)')
              ),
              CtrlFlowDsl.sequence(
                CtrlFlowDsl.runScript('syncedData = localData'),
                CtrlFlowDsl.log('Using local data (more recent)')
              )
            )
          )
        ),

        CtrlFlowDsl.assert('syncedData !== undefined', 'Synced data should be set'),
        CtrlFlowDsl.log('Synchronization completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify sync
      expect(result.success).toBe(true);
      expect(result.variables.syncedData.value).toBe('remote'); // Remote is more recent
    });
  });
});
