---
description: 数据库迁移 — 安全创建、测试和部署 Schema 变更
---

# Database Migration Workflow

Use this for any schema change: new tables, column changes, RLS policies, function updates.

## 1. Analyze Current State
- Confirm `database_profile` exists in the Task Contract. If database target,
  migration tool, backup/restore, runtime access, or rollback ownership is
  unclear, block before writing SQL.
- Check existing schema: `\d <table>` or query `information_schema`
- Review existing RLS policies if applicable
- Check for dependent views, functions, or triggers
- Identify data that may be affected

## 2. Plan Migration
- Write forward migration SQL
- Write rollback migration SQL
- Identify data transformations needed
- Check for breaking changes to existing queries/APIs

## 3. Create Migration File
- Use Drizzle migration if project uses Drizzle ORM
- Otherwise create timestamped SQL file: `YYYYMMDD_HHMMSS_description.sql`
- Include both `-- migrate:up` and `-- migrate:down` sections

## 4. Test Locally
- Apply migration to local/dev database
- Verify schema changes: `\d <table>`
- Run existing tests to catch regressions
- Test rollback: apply down migration, verify clean rollback

## 5. Deploy
- Backup production data if destructive changes
- Apply migration to staging/production
- Verify with schema inspection queries
- Monitor application logs for errors

## Completion Checklist
- [ ] Forward migration SQL tested
- [ ] Rollback migration SQL tested
- [ ] RLS policies updated (if applicable)
- [ ] No breaking changes to existing queries
- [ ] Application tests pass after migration
- [ ] Data integrity verified
- [ ] Rollback plan documented

## Safety Rules
- NEVER drop columns/tables without explicit user confirmation
- ALWAYS have a rollback script before deploying forward
- For large tables: use `ALTER TABLE ... ADD COLUMN` with defaults, avoid table rewrites
- For data migrations: test with a subset first, then full dataset
- Record `Rejected:` trailer in commits if a migration approach was abandoned

## Notes
- If using Supabase, check Edge Function compatibility after schema changes
- For PostgreSQL LISTEN/NOTIFY affected tables, verify trigger/function updates
- Keep migrations small and focused — one concern per migration
