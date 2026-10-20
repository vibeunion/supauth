// V7 may already be recorded as applied on existing projects. Keep a
// forward-only, idempotent copy so those projects also receive the privilege
// repair instead of relying on a migration body being re-executed by name.
export { MIGRATION_V7_SQL as MIGRATION_V16_SQL } from './v7.js';
