/**
 * Simple Workflow Integration Tests
 *
 * Tests simple end-to-end workflows combining:
 * - SetVariable → Assert → Log
 * - Conditional branching
 * - Basic error handling
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CtrlFlowEngine } from '../src/CtrlFlowEngine/CtrlFlowEngine';
import { CtrlFlowDsl } from '../src/CtrlFlowEngine/CtrlFlowDsl';

describe('Simple Workflow Integration', () => {
  let engine: CtrlFlowEngine;

  beforeEach(() => {
    engine = new CtrlFlowEngine();
  });

  describe('Variable Set and Validation', () => {
    it('should set variable, assert it, and log result', async () => {
      // Arrange: Create simple workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting workflow'),
        CtrlFlowDsl.setVariable('username', 'testuser'),
        CtrlFlowDsl.assert('username === "testuser"', 'Username should be testuser'),
        CtrlFlowDsl.log('Username validated successfully'),
        CtrlFlowDsl.setVariable('result', 'success')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify complete workflow
      expect(result.success).toBe(true);
      expect(result.variables.username).toBe('testuser');
      expect(result.variables.result).toBe('success');
      expect(result.logs).toHaveLength(2);
    });

    it('should validate multiple variables', async () => {
      // Arrange: Create workflow validating multiple variables
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('name', 'Alice'),
        CtrlFlowDsl.setVariable('age', 30),
        CtrlFlowDsl.setVariable('email', 'alice@example.com'),
        CtrlFlowDsl.assert('name === "Alice"', 'Name validation'),
        CtrlFlowDsl.assert('age > 18', 'Age validation'),
        CtrlFlowDsl.assert('email.includes("@")', 'Email validation'),
        CtrlFlowDsl.log('All validations passed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify all validations
      expect(result.success).toBe(true);
      expect(result.logs[0]).toContain('All validations passed');
    });

    it('should handle validation failure', async () => {
      // Arrange: Create workflow with failing validation
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('value', 10),
        CtrlFlowDsl.assert('value > 100', 'Value should be greater than 100'),
        CtrlFlowDsl.log('This should not execute')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify failure
      expect(result.success).toBe(false);
      expect(result.logs).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Conditional Workflows', () => {
    it('should execute different paths based on condition', async () => {
      // Arrange: Create conditional workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('mode', 'production'),
        CtrlFlowDsl.log('Checking mode'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "development"'),
            CtrlFlowDsl.setVariable('config', 'dev-config'),
            CtrlFlowDsl.log('Using development config')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('mode === "production"'),
            CtrlFlowDsl.setVariable('config', 'prod-config'),
            CtrlFlowDsl.log('Using production config')
          )
        ),
        CtrlFlowDsl.assert('config !== undefined', 'Config should be set')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify correct path taken
      expect(result.success).toBe(true);
      expect(result.variables.config).toBe('prod-config');
      expect(result.logs.some(log => log.includes('production'))).toBe(true);
    });

    it('should handle fallback in conditional logic', async () => {
      // Arrange: Create workflow with fallback
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('priority', 'low'),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('priority === "high"'),
            CtrlFlowDsl.setVariable('waitTime', 0)
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('priority === "medium"'),
            CtrlFlowDsl.setVariable('waitTime', 5)
          ),
          // Fallback for all other priorities
          CtrlFlowDsl.setVariable('waitTime', 10)
        ),
        CtrlFlowDsl.log('Wait time set')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify fallback executed
      expect(result.success).toBe(true);
      expect(result.variables.waitTime).toBe(10);
    });

    it('should handle multi-condition validation', async () => {
      // Arrange: Create workflow with multiple conditions
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('temperature', 75),
        CtrlFlowDsl.setVariable('humidity', 60),
        CtrlFlowDsl.selector(
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('temperature > 80 && humidity > 70'),
            CtrlFlowDsl.setVariable('weather', 'hot and humid')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('temperature > 80'),
            CtrlFlowDsl.setVariable('weather', 'hot')
          ),
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.condition('humidity > 70'),
            CtrlFlowDsl.setVariable('weather', 'humid')
          ),
          CtrlFlowDsl.setVariable('weather', 'comfortable')
        )
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify correct condition matched
      expect(result.success).toBe(true);
      expect(result.variables.weather).toBe('comfortable');
    });
  });

  describe('Data Processing Workflows', () => {
    it('should process and validate data', async () => {
      // Arrange: Create data processing workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting data processing'),
        CtrlFlowDsl.setVariable('rawValue', 100),
        CtrlFlowDsl.runScript('processedValue = rawValue * 1.1'),
        CtrlFlowDsl.runScript('roundedValue = Math.round(processedValue)'),
        CtrlFlowDsl.assert('roundedValue === 110', 'Processed value should be 110'),
        CtrlFlowDsl.log('Data processing completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify processing
      expect(result.success).toBe(true);
      expect(result.variables.roundedValue).toBe(110);
    });

    it('should calculate and validate results', async () => {
      // Arrange: Create calculation workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('quantity', 5),
        CtrlFlowDsl.setVariable('price', 19.99),
        CtrlFlowDsl.runScript('subtotal = quantity * price'),
        CtrlFlowDsl.runScript('tax = subtotal * 0.08'),
        CtrlFlowDsl.runScript('total = subtotal + tax'),
        CtrlFlowDsl.assert('total > subtotal', 'Total should be greater than subtotal'),
        CtrlFlowDsl.log('Order calculation completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify calculations
      expect(result.success).toBe(true);
      expect(result.variables.total).toBeGreaterThan(result.variables.subtotal);
    });

    it('should transform array data', async () => {
      // Arrange: Create array transformation workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('numbers', [1, 2, 3, 4, 5]),
        CtrlFlowDsl.runScript('sum = numbers.reduce((a, b) => a + b, 0)'),
        CtrlFlowDsl.runScript('average = sum / numbers.length'),
        CtrlFlowDsl.assert('average === 3', 'Average should be 3'),
        CtrlFlowDsl.log('Array processing completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify transformation
      expect(result.success).toBe(true);
      expect(result.variables.average).toBe(3);
    });
  });

  describe('User Registration Workflow', () => {
    it('should complete user registration workflow', async () => {
      // Arrange: Create user registration workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Starting user registration'),

        // Collect user data
        CtrlFlowDsl.setVariable('username', 'johndoe'),
        CtrlFlowDsl.setVariable('email', 'john@example.com'),
        CtrlFlowDsl.setVariable('age', 25),

        // Validate inputs
        CtrlFlowDsl.assert('username.length >= 3', 'Username too short'),
        CtrlFlowDsl.assert('email.includes("@")', 'Invalid email'),
        CtrlFlowDsl.assert('age >= 18', 'User must be 18 or older'),

        // Create user record
        CtrlFlowDsl.runScript('user = { username, email, age, createdAt: Date.now() }'),
        CtrlFlowDsl.setVariable('registrationStatus', 'success'),

        CtrlFlowDsl.log('User registration completed')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify registration
      expect(result.success).toBe(true);
      expect(result.variables.registrationStatus).toBe('success');
      expect(result.variables.user).toBeDefined();
      expect(result.variables.user.username).toBe('johndoe');
    });

    it('should reject invalid user registration', async () => {
      // Arrange: Create workflow with invalid data
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('username', 'ab'), // Too short
        CtrlFlowDsl.setVariable('email', 'invalid-email'),
        CtrlFlowDsl.assert('username.length >= 3', 'Username too short'),
        CtrlFlowDsl.setVariable('status', 'success')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify rejection
      expect(result.success).toBe(false);
      expect(result.variables.status).toBeUndefined();
    });
  });

  describe('Order Processing Workflow', () => {
    it('should process order successfully', async () => {
      // Arrange: Create order processing workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Processing order'),

        // Order details
        CtrlFlowDsl.setVariable('items', [
          { name: 'Product A', price: 10, quantity: 2 },
          { name: 'Product B', price: 15, quantity: 1 },
        ]),

        // Calculate total
        CtrlFlowDsl.runScript('subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0)'),
        CtrlFlowDsl.assert('subtotal > 0', 'Order must have items'),

        // Apply discount
        CtrlFlowDsl.runScript('discount = subtotal > 30 ? subtotal * 0.1 : 0'),
        CtrlFlowDsl.runScript('total = subtotal - discount'),

        // Finalize
        CtrlFlowDsl.setVariable('orderStatus', 'confirmed'),
        CtrlFlowDsl.log('Order processed successfully')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify order processing
      expect(result.success).toBe(true);
      expect(result.variables.subtotal).toBe(35);
      expect(result.variables.discount).toBeGreaterThan(0);
      expect(result.variables.total).toBeLessThan(result.variables.subtotal);
      expect(result.variables.orderStatus).toBe('confirmed');
    });
  });

  describe('Configuration Workflow', () => {
    it('should load and validate configuration', async () => {
      // Arrange: Create configuration workflow
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Loading configuration'),

        // Set config
        CtrlFlowDsl.setVariable('config', {
          apiUrl: 'https://api.example.com',
          timeout: 5000,
          retries: 3,
        }),

        // Validate config
        CtrlFlowDsl.assert('config.apiUrl.startsWith("https")', 'API must use HTTPS'),
        CtrlFlowDsl.assert('config.timeout > 0', 'Timeout must be positive'),
        CtrlFlowDsl.assert('config.retries >= 0', 'Retries must be non-negative'),

        CtrlFlowDsl.setVariable('configValid', true),
        CtrlFlowDsl.log('Configuration validated')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify configuration
      expect(result.success).toBe(true);
      expect(result.variables.configValid).toBe(true);
    });

    it('should reject insecure configuration', async () => {
      // Arrange: Create workflow with insecure config
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('config', {
          apiUrl: 'http://api.example.com', // Not HTTPS
          timeout: 5000,
        }),
        CtrlFlowDsl.assert('config.apiUrl.startsWith("https")', 'API must use HTTPS'),
        CtrlFlowDsl.setVariable('approved', true)
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify rejection
      expect(result.success).toBe(false);
      expect(result.variables.approved).toBeUndefined();
    });
  });

  describe('State Machine Workflow', () => {
    it('should transition through states correctly', async () => {
      // Arrange: Create simple state machine
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.setVariable('state', 'idle'),
        CtrlFlowDsl.log('State: idle'),

        CtrlFlowDsl.condition('state === "idle"'),
        CtrlFlowDsl.setVariable('state', 'loading'),
        CtrlFlowDsl.log('State: loading'),

        CtrlFlowDsl.condition('state === "loading"'),
        CtrlFlowDsl.setVariable('state', 'ready'),
        CtrlFlowDsl.log('State: ready'),

        CtrlFlowDsl.assert('state === "ready"', 'Should reach ready state')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify state transitions
      expect(result.success).toBe(true);
      expect(result.variables.state).toBe('ready');
      expect(result.logs).toHaveLength(3);
    });
  });

  describe('Error Recovery Workflow', () => {
    it('should use selector for error recovery', async () => {
      // Arrange: Create workflow with error recovery
      const tree = CtrlFlowDsl.sequence(
        CtrlFlowDsl.log('Attempting operation'),
        CtrlFlowDsl.selector(
          // Try primary operation
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.setVariable('useCache', true),
            CtrlFlowDsl.condition('useCache === false'), // Will fail
            CtrlFlowDsl.setVariable('result', 'from primary')
          ),
          // Fallback operation
          CtrlFlowDsl.sequence(
            CtrlFlowDsl.log('Using fallback'),
            CtrlFlowDsl.setVariable('result', 'from fallback')
          )
        ),
        CtrlFlowDsl.assert('result !== undefined', 'Result should be set')
      );

      // Act: Run the test
      const result = await engine.runTest(tree);

      // Assert: Verify fallback used
      expect(result.success).toBe(true);
      expect(result.variables.result).toBe('from fallback');
    });
  });
});
