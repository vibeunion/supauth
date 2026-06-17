import * as XLSX from 'xlsx';
import { pinyin } from 'pinyin-pro';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

interface ProvisioningRecord {
  external_id: string;
  external_type: string;
  display_name: string;
  email: string;
  source_status: string;
  profile: Record<string, unknown>;
  import_batch: string;
  metadata: Record<string, unknown>;
}

interface Args {
  input: string;
  output: string;
  csvOutput: string;
  domain: string;
  batch: string;
  externalType: string;
}

interface NormalizedRow {
  externalId: string;
  displayName: string;
  sourceStatus: string;
  department: string;
  company: string;
  role: string;
  sourceSeq: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const input = args.find(arg => !arg.startsWith('--'));
  if (!input) {
    throw new Error('Usage: bun run scripts/generate-account-provisioning-manifest.ts <xlsx> [--out path] [--csv path] [--domain example.team] [--batch name] [--external-type employee]');
  }
  const option = (name: string, fallback: string) => {
    const prefix = `--${name}=`;
    const found = args.find(arg => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };
  const batch = option('batch', 'account-provisioning-2026-06-09');
  return {
    input,
    output: option('out', `.agents/state/${batch}/import-manifest.json`),
    csvOutput: option('csv', `.agents/state/${batch}/import-review.csv`),
    domain: option('domain', 'example.team').replace(/^@/, '').toLowerCase(),
    batch,
    externalType: option('external-type', 'employee'),
  };
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeExternalIdForManifest(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  if (/^\d+$/.test(normalized) && normalized.length < 4) {
    return normalized.padStart(4, '0');
  }
  return normalized;
}

function slugName(name: string): string {
  const raw = pinyin(name, { toneType: 'none', type: 'array', v: true }) as string[];
  const slug = raw.join('').toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug || 'user';
}

function suffixFromExternalId(externalId: string): string {
  return externalId.replace(/\D/g, '').slice(-4) || externalId.slice(-4).toLowerCase();
}

function buildEmails(rows: Array<{ externalId: string; displayName: string }>, domain: string) {
  const baseCounts = new Map<string, number>();
  for (const row of rows) {
    const base = slugName(row.displayName);
    baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
  }

  const used = new Set<string>();
  const emails = new Map<string, string>();
  for (const row of rows) {
    const base = slugName(row.displayName);
    const needsSuffix = (baseCounts.get(base) || 0) > 1;
    let local = needsSuffix ? `${base}.${suffixFromExternalId(row.externalId)}` : base;
    let email = `${local}@${domain}`;
    let n = 2;
    while (used.has(email)) {
      local = `${base}.${suffixFromExternalId(row.externalId)}.${n}`;
      email = `${local}@${domain}`;
      n += 1;
    }
    used.add(email);
    emails.set(row.externalId, email);
  }
  return emails;
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const args = parseArgs();
  const workbook = XLSX.readFile(args.input);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const normalized: NormalizedRow[] = rows.map((row: Record<string, unknown>) => ({
    externalId: normalizeExternalIdForManifest(cell(row, '数字ID') || cell(row, 'external_id') || cell(row, 'External ID')),
    displayName: cell(row, '姓名') || cell(row, 'display_name') || cell(row, 'Display Name'),
    sourceStatus: cell(row, '状态') || cell(row, 'source_status') || 'active',
    department: cell(row, '部门'),
    company: cell(row, '企业'),
    role: cell(row, '角色'),
    sourceSeq: cell(row, '序号'),
  })).filter((row: NormalizedRow) => row.externalId && row.displayName);

  const emails = buildEmails(normalized, args.domain);
  const records: ProvisioningRecord[] = normalized.map((row: NormalizedRow) => ({
    external_id: row.externalId,
    external_type: args.externalType,
    display_name: row.displayName,
    email: emails.get(row.externalId) || `${row.externalId}@${args.domain}`,
    source_status: row.sourceStatus === '正常' ? 'active' : row.sourceStatus,
    profile: {
      department: row.department || null,
      company: row.company || null,
      role: row.role || null,
    },
    import_batch: args.batch,
    metadata: {
      source: args.batch,
      source_sheet: sheetName,
      source_seq: row.sourceSeq || null,
    },
  }));

  const eligible = records.filter(record => ['active', '正常'].includes(record.source_status)).length;
  const skipped = records.length - eligible;
  const manifest = {
    generated_at: new Date().toISOString(),
    source: args.input,
    email_domain: args.domain,
    external_type: args.externalType,
    summary: {
      total: records.length,
      eligible,
      skipped,
    },
    records,
  };

  await mkdir(dirname(args.output), { recursive: true });
  await mkdir(dirname(args.csvOutput), { recursive: true });
  await Bun.write(args.output, JSON.stringify(manifest, null, 2));
  const csvHeader = ['external_id', 'external_type', 'display_name', 'email', 'source_status', 'department', 'company', 'role'];
  const csvBody = records.map(record => {
    const row = {
      ...record,
      department: record.profile.department,
      company: record.profile.company,
      role: record.profile.role,
    };
    return csvHeader.map(key => csvEscape(row[key as keyof typeof row])).join(',');
  });
  await Bun.write(args.csvOutput, `${csvHeader.join(',')}\n${csvBody.join('\n')}\n`);
  console.log(JSON.stringify({ output: args.output, csv: args.csvOutput, ...manifest.summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
