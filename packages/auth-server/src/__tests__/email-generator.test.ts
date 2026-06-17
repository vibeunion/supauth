import { describe, expect, test } from 'bun:test';
import {
  nameToPinyinBase,
  generateUniqueEmail,
  batchGenerateEmails,
  formatSuffix,
} from '../utils/email-generator.js';

describe('nameToPinyinBase', () => {
  test('converts Chinese names to pinyin', () => {
    expect(nameToPinyinBase('张三')).toBe('zhangsan');
    expect(nameToPinyinBase('王小明')).toBe('wangxiaoming');
    expect(nameToPinyinBase('李四')).toBe('lisi');
  });

  test('handles mixed Chinese and Latin characters', () => {
    expect(nameToPinyinBase('张Alex')).toBe('zhangalex');
  });

  test('handles pure Latin names', () => {
    expect(nameToPinyinBase('Alice')).toBe('alice');
  });

  test('handles numbers in names', () => {
    expect(nameToPinyinBase('张3')).toBe('zhang3');
  });

  test('returns fallback for empty/invalid input', () => {
    expect(nameToPinyinBase('')).toBe('user');
    expect(nameToPinyinBase('123')).toBe('123');
  });
});

describe('formatSuffix', () => {
  test('zero-pads numeric suffixes', () => {
    expect(formatSuffix(231, 4)).toBe('0231');
    expect(formatSuffix('231', 4)).toBe('0231');
    expect(formatSuffix(10086, 4)).toBe('10086');
  });

  test('handles non-numeric strings', () => {
    expect(formatSuffix('abc', 4)).toBe('abc');
  });
});

describe('generateUniqueEmail', () => {
  test('generates clean email when no collision', () => {
    const result = generateUniqueEmail('张三', new Set(), '10086');
    expect(result).toBe('zhangsan@example.com');
  });

  test('adds suffix from external_id when base collides', () => {
    const existing = new Set(['zhangsan']);
    const result = generateUniqueEmail('张三', existing, '10086');
    expect(result).toBe('zhangsan.0086@example.com');
  });

  test('uses last 4 digits when external_id is longer', () => {
    const existing = new Set(['zhangsan']);
    const result = generateUniqueEmail('张三', existing, 'A02317');
    // 'A02317' last 4 chars = '2317'
    expect(result).toBe('zhangsan.2317@example.com');
  });

  test('pads short external_id', () => {
    const existing = new Set(['zhangsan']);
    const result = generateUniqueEmail('张三', existing, '1');
    expect(result).toBe('zhangsan.0001@example.com');
  });

  test('increments numerically when suffix also collides', () => {
    const existing = new Set(['zhangsan', 'zhangsan.0001']);
    const result = generateUniqueEmail('张三', existing, '1');
    expect(result).toBe('zhangsan.0002@example.com');
  });

  test('respects custom domain', () => {
    const result = generateUniqueEmail('张三', new Set(), '1', { domain: 'example.com' });
    expect(result).toBe('zhangsan@example.com');
  });
});

describe('batchGenerateEmails', () => {
  test('generates emails for a batch without collisions', () => {
    const records = [
      { display_name: '张三', external_id: '001' },
      { display_name: '李四', external_id: '002' },
      { display_name: '王小明', external_id: '003' },
    ];
    const result = batchGenerateEmails(records, new Set());
    expect(result.get('001')).toBe('zhangsan@example.com');
    expect(result.get('002')).toBe('lisi@example.com');
    expect(result.get('003')).toBe('wangxiaoming@example.com');
  });

  test('handles intra-batch duplicate pinyin bases', () => {
    // Two people named 张三
    const records = [
      { display_name: '张三', external_id: '0231' },
      { display_name: '张三', external_id: '0232' },
    ];
    const result = batchGenerateEmails(records, new Set());
    expect(result.get('0231')).toBe('zhangsan@example.com');
    expect(result.get('0232')).toBe('zhangsan.0232@example.com');
  });

  test('preserves explicitly provided emails', () => {
    const records = [
      { display_name: '张三', external_id: '001', email: 'custom@other.com' },
      { display_name: '李四', external_id: '002' },
    ];
    const result = batchGenerateEmails(records, new Set());
    expect(result.get('001')).toBe('custom@other.com');
    expect(result.get('002')).toBe('lisi@example.com');
  });

  test('handles collision with existing emails', () => {
    const records = [
      { display_name: '张三', external_id: '0231' },
    ];
    const existing = new Set(['zhangsan']); // already taken
    const result = batchGenerateEmails(records, existing);
    expect(result.get('0231')).toBe('zhangsan.0231@example.com');
  });

  test('handles collision with explicit email in batch', () => {
    const records = [
      { display_name: '张三', external_id: '0231', email: 'zhangsan@example.com' },
      { display_name: '张三', external_id: '0232' },
    ];
    const result = batchGenerateEmails(records, new Set());
    expect(result.get('0231')).toBe('zhangsan@example.com');
    // The second 张三 should get a suffix
    expect(result.get('0232')).toBe('zhangsan.0232@example.com');
  });
});
