import { HOSTED_MIGRATION_CATALOG } from './catalog.js';
import { MIGRATION_SQL } from './v1.js';
import { MIGRATION_V4_SQL } from './v4.js';
import { MIGRATION_V5_SQL } from './v5.js';
import { MIGRATION_V6_SQL } from './v6.js';
import { MIGRATION_V7_SQL } from './v7.js';
import { MIGRATION_V8_SQL } from './v8.js';
import { MIGRATION_V9_SQL } from './v9.js';
import { MIGRATION_V10_SQL } from './v10.js';
import { MIGRATION_V11_SQL } from './v11.js';
import { MIGRATION_V12_SQL } from './v12.js';
import { MIGRATION_V13_SQL } from './v13.js';
import { MIGRATION_V14_SQL } from './v14.js';
import { MIGRATION_V15_SQL } from './v15.js';
import { MIGRATION_V16_SQL } from './v16.js';
import { MIGRATION_V17_SQL } from './v17.js';
import { MIGRATION_V18_SQL } from './v18.js';

export {
  MIGRATION_SQL,
  MIGRATION_V4_SQL,
  MIGRATION_V5_SQL,
  MIGRATION_V6_SQL,
  MIGRATION_V7_SQL,
  MIGRATION_V8_SQL,
  MIGRATION_V9_SQL,
  MIGRATION_V10_SQL,
  MIGRATION_V11_SQL,
  MIGRATION_V12_SQL,
  MIGRATION_V13_SQL,
  MIGRATION_V14_SQL,
  MIGRATION_V15_SQL,
  MIGRATION_V16_SQL,
  MIGRATION_V17_SQL,
  MIGRATION_V18_SQL,
};

type HostedMigrationVersion = (typeof HOSTED_MIGRATION_CATALOG)[number]['version'];

const SQL_BY_VERSION = {
  '1': MIGRATION_SQL,
  '4': MIGRATION_V4_SQL,
  '5': MIGRATION_V5_SQL,
  '6': MIGRATION_V6_SQL,
  '7': MIGRATION_V7_SQL,
  '8': MIGRATION_V8_SQL,
  '9': MIGRATION_V9_SQL,
  '10': MIGRATION_V10_SQL,
  '11': MIGRATION_V11_SQL,
  '12': MIGRATION_V12_SQL,
  '13': MIGRATION_V13_SQL,
  '14': MIGRATION_V14_SQL,
  '15': MIGRATION_V15_SQL,
  '16': MIGRATION_V16_SQL,
  '17': MIGRATION_V17_SQL,
  '18': MIGRATION_V18_SQL,
} as const satisfies Record<HostedMigrationVersion, string>;

export const HOSTED_MIGRATIONS: readonly {
  readonly name: (typeof HOSTED_MIGRATION_CATALOG)[number]['name'];
  readonly sql: string;
}[] = HOSTED_MIGRATION_CATALOG.map(({ name, version }) => ({
  name,
  sql: SQL_BY_VERSION[version],
} as const));
