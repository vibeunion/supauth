import { afterEach, describe, expect, it } from 'bun:test';
import { getConfig, loadConfig } from '../config/index.js';

afterEach(() => {
  delete process.env['LOG_LEVEL'];
  loadConfig();
});

describe('log-level environment boundary', () => {
  it('retains the default for absent and empty values', () => {
    delete process.env['LOG_LEVEL'];
    expect(loadConfig().logLevel).toBe('info');
    process.env['LOG_LEVEL'] = '';
    expect(loadConfig().logLevel).toBe('info');
  });

  it('accepts only the declared log-level enum', () => {
    for (const value of ['debug', 'info', 'warn', 'error'] as const) {
      process.env['LOG_LEVEL'] = value;
      expect(loadConfig().logLevel).toBe(value);
    }
  });

  it('rejects invalid values without exposing them or replacing valid config', () => {
    process.env['LOG_LEVEL'] = 'warn';
    const validConfig = loadConfig();
    for (const value of ['trace', 'INFO', ' info ', 'false', '0', 'synthetic-private-value']) {
      process.env['LOG_LEVEL'] = value;
      expect(loadConfig).toThrow('LOG_LEVEL must be debug, info, warn, or error');
      expect(getConfig()).toBe(validConfig);
    }
  });
});
