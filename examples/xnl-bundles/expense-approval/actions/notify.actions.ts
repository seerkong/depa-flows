interface NotificationRuntime {
  notify(message: { recipient?: string; kind: string; payload: unknown }): Promise<void>;
}

export async function notifyTaskOwner(
  runtime: NotificationRuntime,
  input: unknown,
  config: Readonly<{ owner: string }>,
) {
  await runtime.notify({ recipient: config.owner, kind: 'task-ready', payload: input });
  return input;
}

export async function notifyRejection(
  runtime: NotificationRuntime,
  input: unknown,
  _config: Readonly<Record<string, never>>,
) {
  await runtime.notify({ kind: 'expense-rejected', payload: input });
  return input;
}
