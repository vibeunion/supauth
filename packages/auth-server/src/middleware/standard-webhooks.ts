import { Elysia } from 'elysia';
import { captureStandardWebhookBody } from '../auth/standard-webhooks.js';

export const standardWebhookBodyCapture = new Elysia({ name: 'standard-webhook-body-capture' })
  .onRequest(({ request }) => captureStandardWebhookBody(request));
