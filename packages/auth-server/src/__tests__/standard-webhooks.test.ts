import { describe, expect, it } from 'bun:test';
import {
  StandardWebhookEnvelopeError,
  captureStandardWebhookBody,
  standardWebhookMessage,
} from '../auth/standard-webhooks.js';

const payload = '{"user_id":"gotrue-user"}';

function webhookRequest(overrides: Record<string, string> = {}): Request {
  return new Request('http://localhost/v1/auth-hooks/custom-access-token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'cf25da76-84af-4dca-8b75-b96ad5531d8a',
      'webhook-timestamp': '1715686621',
      'webhook-signature': 'v1,signature',
      ...overrides,
    },
    body: payload,
  });
}

describe('Standard Webhooks envelope forwarding', () => {
  it('forwards the three standard headers and exact raw body bytes', async () => {
    await expect(standardWebhookMessage(webhookRequest())).resolves.toEqual({
      webhook_id: 'cf25da76-84af-4dca-8b75-b96ad5531d8a',
      webhook_timestamp: '1715686621',
      webhook_signature: 'v1,signature',
      body_base64: Buffer.from(payload).toString('base64'),
    });
  });

  it('preserves captured bytes after Elysia-style body parsing consumes the request', async () => {
    const request = webhookRequest();
    await captureStandardWebhookBody(request);
    await request.json();

    expect((await standardWebhookMessage(request)).body_base64)
      .toBe(Buffer.from(payload).toString('base64'));
  });

  it('rejects missing standard headers before forwarding', async () => {
    const request = webhookRequest({ 'webhook-id': '' });
    await expect(standardWebhookMessage(request)).rejects.toBeInstanceOf(StandardWebhookEnvelopeError);
  });

  it('rejects duplicated ID and timestamp headers', async () => {
    const duplicateId = webhookRequest();
    duplicateId.headers.append('webhook-id', 'second-id');
    await expect(standardWebhookMessage(duplicateId)).rejects.toThrow('duplicate');

    const duplicateTimestamp = webhookRequest();
    duplicateTimestamp.headers.append('webhook-timestamp', '1715686622');
    await expect(standardWebhookMessage(duplicateTimestamp)).rejects.toThrow('duplicate');
  });
});
