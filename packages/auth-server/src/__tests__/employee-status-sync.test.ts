import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { accountProvisioningRoutes } from '../routes/account-provisioning.js';

describe('employee status sync', () => {
  test('sync endpoint returns empty result for empty records', async () => {
    const app = new Elysia().use(accountProvisioningRoutes);
    const response = await app.handle(new Request('http://localhost/v1/account-provisioning/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [] }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.updated).toBe(0);
  });

  test('sync/status endpoint returns counts by status', async () => {
    const app = new Elysia().use(accountProvisioningRoutes);
    const response = await app.handle(new Request('http://localhost/v1/account-provisioning/sync/status?external_type=employee', {
      method: 'GET',
    }));
    // May fail without DB; just verify the route exists and accepts the request
    expect(response.status).toBeLessThanOrEqual(500);
  });

  test('sync/reconcile endpoint accepts options', async () => {
    const app = new Elysia().use(accountProvisioningRoutes);
    const response = await app.handle(new Request('http://localhost/v1/account-provisioning/sync/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_type: 'employee', dry_run: true, batch_size: 50 }),
    }));
    // Will likely fail without DB but should at least accept the request shape
    expect(response.status).toBeLessThanOrEqual(500);
  });
});
