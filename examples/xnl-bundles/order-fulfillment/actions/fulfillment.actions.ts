interface FulfillmentRuntime {
  reserveInventory(endpoint: string, input: unknown): Promise<{ reservationId: string }>;
  notifyCustomer(input: FulfillmentState): Promise<boolean>;
}

export interface FulfillmentInput {
  orderId?: string;
}

interface FulfillmentState {
  reservationId?: string;
  notifyAttempts: number;
  notified: boolean;
  [key: string]: unknown;
}

interface FulfillmentAudit {
  kind: 'order-fulfilled';
  reservationId?: string;
  parcelId?: string;
}

interface FulfillmentParallelResult {
  notification: FulfillmentState;
  audit: FulfillmentAudit;
}

export interface FulfillmentResult {
  outcome: 'fulfilled';
  reservationId?: string;
  parcelId?: string;
  notificationAttempts: number;
}

async function reserveInventory(
  runtime: FulfillmentRuntime,
  input: unknown,
  config: Readonly<{ endpoint: string }>,
): Promise<FulfillmentState> {
  const reservation = await runtime.reserveInventory(config.endpoint, input);
  return { ...reservation, notifyAttempts: 0, notified: false };
}

export function reservePrimaryInventory(
  runtime: FulfillmentRuntime,
  input: unknown,
  config: Readonly<{ endpoint: string }>,
): Promise<FulfillmentState> {
  return reserveInventory(runtime, input, config);
}

export async function notifyCustomer(
  runtime: FulfillmentRuntime,
  input: FulfillmentState,
  _config: Readonly<Record<string, never>>,
): Promise<FulfillmentState> {
  const notified = await runtime.notifyCustomer(input);
  if (!notified) throw new Error('customer notification was not accepted');
  return { ...input, notifyAttempts: input.notifyAttempts + 1, notified };
}

export function prepareFulfillmentAudit(
  _runtime: FulfillmentRuntime,
  input: FulfillmentState,
  _config: Readonly<Record<string, never>>,
): FulfillmentAudit {
  return {
    kind: 'order-fulfilled',
    reservationId: input.reservationId,
    parcelId: typeof input.parcelId === 'string' ? input.parcelId : undefined,
  };
}

export function toFulfilledResult(
  _runtime: FulfillmentRuntime,
  input: FulfillmentParallelResult,
  _config: Readonly<Record<string, never>>,
): FulfillmentResult {
  return {
    outcome: 'fulfilled',
    reservationId: input.audit.reservationId,
    parcelId: input.audit.parcelId,
    notificationAttempts: input.notification.notifyAttempts,
  };
}
