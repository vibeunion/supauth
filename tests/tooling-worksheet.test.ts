import { describe, expect, test } from 'bun:test';
import { decodeWorksheetRows } from '../scripts/generate-account-provisioning-manifest.js';

describe('worksheet input contract without generating artifacts', () => {
  test.each([
    null, {}, [null], [['invalid']], [{ external_id: {}, display_name: 'User' }],
    [{ external_id: 1, display_name: [] }], [{ external_id: Number.NaN, display_name: 'User' }],
  ].map(value => ({ value })))('rejects invalid worksheet rows %#', ({ value }) => {
    expect(() => decodeWorksheetRows(value)).toThrow();
  });

  test('preserves scalar normalization and the existing blank-row policy', () => {
    expect(decodeWorksheetRows([
      {},
      { external_id: 7, display_name: ' User ', source_status: 'active' },
    ])).toEqual([{
      externalId: '0007', displayName: 'User', sourceStatus: 'active',
      department: '', company: '', role: '', sourceSeq: '',
    }]);
  });
});
