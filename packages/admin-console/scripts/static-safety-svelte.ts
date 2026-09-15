import { parse } from 'svelte/compiler';

export interface SvelteSafetyRegion {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface SvelteSafetyScript extends SvelteSafetyRegion {
  readonly kind: 'instance' | 'module';
}

export interface SvelteSafetyTemplateRegion extends SvelteSafetyRegion {
  readonly kind: 'expression' | 'statement' | 'pattern';
  readonly nodeType: string;
}

export interface SvelteSafetyExtraction {
  readonly scripts: readonly SvelteSafetyScript[];
  readonly templateExpressions: readonly SvelteSafetyTemplateRegion[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function range(value: unknown, source: string): SvelteSafetyRegion {
  if (!record(value)) throw new Error('Svelte parser returned an invalid source region');
  const start = value['start'];
  const end = value['end'];
  if (
    typeof start !== 'number' || typeof end !== 'number'
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end > source.length
  ) {
    throw new Error('Svelte parser returned invalid source offsets');
  }
  return { start, end, text: source.slice(start, end) };
}

function templateKind(type: string): SvelteSafetyTemplateRegion['kind'] | null {
  if (type === 'VariableDeclaration') return 'statement';
  if (type === 'Identifier' || type === 'ObjectPattern' || type === 'ArrayPattern' || type === 'AssignmentPattern' || type === 'RestElement') {
    return 'pattern';
  }
  if (
    type.endsWith('Expression')
    || type === 'Literal' || type === 'TemplateLiteral'
    || type === 'Super' || type === 'MetaProperty'
  ) return 'expression';
  return null;
}

/**
 * 返回原组件的 UTF-16 半开区间；不生成代码、不吞掉解析错误。
 * 模板只收集最外层 ESTree 代码节点，内部 TS/JSDoc 语法由调用方的统一门禁检查。
 */
export function extractSvelteSafetyRegions(source: string, filename: string): SvelteSafetyExtraction {
  const root = parse(source, { filename, modern: true });
  const scripts: SvelteSafetyScript[] = [];
  if (root.instance) scripts.push({ kind: 'instance', ...range(root.instance.content, source) });
  if (root.module) scripts.push({ kind: 'module', ...range(root.module.content, source) });
  scripts.sort((left, right) => left.start - right.start);

  const templateExpressions: SvelteSafetyTemplateRegion[] = [];
  const seen = new Set<object>();
  function visit(value: unknown): void {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const children: readonly unknown[] = value;
      for (const child of children) visit(child);
      return;
    }
    if (!record(value)) return;
    const type = value['type'];
    if (typeof type !== 'string') return;
    const kind = templateKind(type);
    if (kind !== null) {
      templateExpressions.push({ kind, nodeType: type, ...range(value, source) });
      return;
    }
    // 未被外层表达式包含的新 TS 语法不能静默丢失。
    if (type.startsWith('TS')) throw new Error(`Unsupported Svelte template TypeScript node: ${type}`);
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'loc' && key !== 'comments' && key !== 'leadingComments' && key !== 'trailingComments') visit(child);
    }
  }
  visit(root.fragment);
  visit(root.options?.attributes);
  templateExpressions.sort((left, right) => left.start - right.start || left.end - right.end);
  return { scripts, templateExpressions };
}
