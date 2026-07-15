interface HealthRuntime {
  http(request: { url: string; method: 'GET' }): Promise<{ status: number }>;
}

export interface HealthCheckInput {
  requestId?: string;
}

interface HealthState {
  attempts: number;
  lastStatus?: number;
}

interface HealthRaceResult {
  winner: string;
  output: HealthState;
}

export interface HealthCheckResult {
  outcome: 'healthy';
  endpoint: string;
  attempts: number;
  status: number;
}

export function initializeHealthCheck(
  _runtime: HealthRuntime,
  _input: HealthCheckInput,
  _config: Readonly<Record<string, never>>,
): HealthState {
  return { attempts: 0 };
}

export function hasHttpCapability(
  runtime: HealthRuntime,
  _input: HealthState,
  _config: Readonly<Record<string, never>>,
): boolean {
  return typeof runtime.http === 'function';
}

export async function probeHealth(
  runtime: HealthRuntime,
  input: HealthState,
  config: Readonly<{ url: string }>,
): Promise<HealthState> {
  const response = await runtime.http({ url: config.url, method: 'GET' });
  if (response.status !== 200) {
    throw new Error(`health probe failed with status ${response.status}`);
  }
  return {
    attempts: input.attempts + 1,
    lastStatus: response.status,
  };
}

export function toHealthResult(
  _runtime: HealthRuntime,
  input: HealthRaceResult,
  _config: Readonly<Record<string, never>>,
): HealthCheckResult {
  if (input.output.lastStatus === undefined) throw new Error('health race completed without a status');
  return {
    outcome: 'healthy',
    endpoint: input.winner,
    attempts: input.output.attempts,
    status: input.output.lastStatus,
  };
}
