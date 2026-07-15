/**
 * HttpCall Action Handler
 *
 * Handles HTTP requests in test execution
 */

import { ActionHandler } from '../../BehaviorTreeCore/ActionHandler';
import { ExecutionContext, BehaviorResult } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType, HttpCallConfig } from '../types';

/**
 * Handler for HttpCall action
 *
 * Makes HTTP requests and optionally saves the response
 */
export class HttpCallActionHandler implements ActionHandler<CtrlFlowNodeType, HttpCallConfig> {
  async execute(context: ExecutionContext<CtrlFlowNodeType, HttpCallConfig>): Promise<BehaviorResult> {
    const { node } = context;
    const config = node.Config;

    try {
      // Prepare request options
      const options: RequestInit = {
        method: config.method,
        headers: config.headers,
      };

      // Add body for non-GET requests
      if (config.body && config.method !== 'GET') {
        if (typeof config.body === 'string') {
          options.body = config.body;
        } else {
          options.body = JSON.stringify(config.body);
          // Set content-type if not already set
          const headers: Record<string, string> = {};

          if (options.headers) {
            if (options.headers instanceof Headers) {
              options.headers.forEach((value, key) => {
                headers[key] = value;
              });
            } else if (typeof options.headers === 'object' && !Array.isArray(options.headers)) {
              Object.entries(options.headers).forEach(([key, value]) => {
                headers[key] = Array.isArray(value) ? value[0] : value;
              });
            }
          }

          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
          options.headers = headers;
        }
      }

      // Make the HTTP request
      const response = await fetch(config.url, options);

      // Parse response based on content type
      let responseData: any;
      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      // Create response object
      const responseObject = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData,
        ok: response.ok,
      };

      // Save response to variable if specified
      if (config.saveResponseTo) {
        context.setVar(config.saveResponseTo, responseObject);
      }

      // Return success if HTTP status is OK (2xx)
      if (response.ok) {
        return BehaviorResult.Success;
      } else {
        console.error(`[${node.Key}] HTTP request failed with status ${response.status}`);
        return BehaviorResult.Failure;
      }
    } catch (error) {
      console.error(`HttpCall failed for node ${node.Key}:`, error);

      // Save error to variable if specified
      if (config.saveResponseTo) {
        context.setVar(config.saveResponseTo, {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        });
      }

      return BehaviorResult.Failure;
    }
  }
}
