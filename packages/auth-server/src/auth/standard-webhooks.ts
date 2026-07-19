export const GOTRUE_HTTP_HOOK_NAMES = [
  'before-user-created',
  'custom-access-token',
] as const;

export type GoTrueHttpHookName = (typeof GOTRUE_HTTP_HOOK_NAMES)[number];

const WEBHOOK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const WEBHOOK_TIMESTAMP_PATTERN = /^[+-]?\d+$/;

export class StandardWebhookEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StandardWebhookEnvelopeError';
  }
}

export type StandardWebhookMessage = {
  webhook_id: string;
  webhook_timestamp: string;
  webhook_signature: string;
  body_base64: string;
};

const capturedBodies = new WeakMap<Request, Buffer>();

function requestTargetsHttpHook(request: Request): boolean {
  if (request.method.toUpperCase() !== 'POST') return false;
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  return GOTRUE_HTTP_HOOK_NAMES.some((hookName) => pathname.endsWith(`/v1/auth-hooks/${hookName}`));
}

function hasStandardWebhookHeaders(headers: Headers): boolean {
  return Boolean(
    headers.get('webhook-id')
    && headers.get('webhook-timestamp')
    && headers.get('webhook-signature'),
  );
}

export async function captureStandardWebhookBody(request: Request): Promise<void> {
  if (!requestTargetsHttpHook(request) || !hasStandardWebhookHeaders(request.headers)) return;
  capturedBodies.set(request, Buffer.from(await request.clone().arrayBuffer()));
}

function requiredHeaders(headers: Headers) {
  const webhookId = headers.get('webhook-id') || '';
  const timestamp = headers.get('webhook-timestamp') || '';
  const signature = headers.get('webhook-signature') || '';
  if (
    !WEBHOOK_ID_PATTERN.test(webhookId)
    || !WEBHOOK_TIMESTAMP_PATTERN.test(timestamp)
    || !signature
    || signature.length > 4_096
  ) {
    throw new StandardWebhookEnvelopeError('Missing, duplicate, or invalid Standard Webhooks headers');
  }
  return { webhookId, timestamp, signature };
}

async function rawRequestBody(request: Request): Promise<Buffer> {
  const captured = capturedBodies.get(request);
  if (captured) return captured;
  if (request.bodyUsed) throw new StandardWebhookEnvelopeError('Raw webhook body is unavailable');
  try {
    return Buffer.from(await request.clone().arrayBuffer());
  } catch {
    throw new StandardWebhookEnvelopeError('Raw webhook body is unavailable');
  }
}

export async function standardWebhookMessage(request: Request): Promise<StandardWebhookMessage> {
  const { webhookId, timestamp, signature } = requiredHeaders(request.headers);
  return {
    webhook_id: webhookId,
    webhook_timestamp: timestamp,
    webhook_signature: signature,
    body_base64: (await rawRequestBody(request)).toString('base64'),
  };
}
