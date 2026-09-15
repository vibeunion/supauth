import ts from 'typescript';

export interface StaticSafetyIssue {
  file: string;
  line: number;
  code: 'explicit_any' | 'non_null_assertion' | 'double_assertion' | 'suppressed_check' | 'syntax_error';
}

function assertion(node: ts.Node): node is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function literalPreservation(type: ts.TypeNode): boolean {
  return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const';
}

function assertionDepth(node: ts.Expression): number {
  if (assertion(node)) return (literalPreservation(node.type) ? 0 : 1) + assertionDepth(node.expression);
  if (ts.isSatisfiesExpression(node)) return assertionDepth(node.expression);
  if (ts.isParenthesizedExpression(node)) {
    const type = ts.getJSDocType(node);
    return (type && !literalPreservation(type) ? 1 : 0) + assertionDepth(node.expression);
  }
  return 0;
}

// 精确注册编译期负例文件，不豁免生产诊断；这些文件还必须通过受检项目覆盖门禁。
const TYPE_ERROR_FIXTURES = new Set([
  'packages/authorization-core/src/index.test.ts',
  'packages/shared/src/__tests__/claims-contract-types.ts',
  'packages/shared/src/__tests__/schema.test.ts',
  'packages/shared/src/__tests__/string-key-records.test.ts',
  'packages/sdks/typescript/src/__tests__/input-compatibility.test.ts',
  'packages/sdks/typescript/src/__tests__/request-contract-types.ts',
  'packages/sdks/typescript/consumers/browser.ts',
  'packages/sdks/typescript/consumers/worker.ts',
  'packages/sdks/auth-ui/tests/consumers/browser.ts',
  'packages/sdks/auth-ui/tests/consumers/worker.ts',
  'packages/auth-server/src/__tests__/account-contract.test.ts',
  'packages/auth-server/src/__tests__/api-value-boundaries.test.ts',
  'packages/auth-server/src/__tests__/server-contract.test.ts',
  'packages/auth-server/src/__tests__/connector-provider-boundary.test.ts',
  'packages/admin-console/src/lib/api/client.test.ts',
  'packages/admin-console/src/lib/api/client.types.ts',
]);

/** 语法门禁不代替编译器、外部数据校验或人工检查普通断言的不变量。 */
export function inspectStaticSafety(text: string, file: string): StaticSafetyIssue[] {
  const normalizedFile = file.replaceAll('\\', '/');
  const source = ts.createSourceFile(normalizedFile, text, ts.ScriptTarget.Latest, true);
  const issues: StaticSafetyIssue[] = [];
  const visited = new Set<ts.Node>();
  const comments = new Map<number, ts.CommentRange>();
  const report = (code: StaticSafetyIssue['code'], position: number) => {
    issues.push({ file, line: source.getLineAndCharacterOfPosition(position).line + 1, code });
  };
  const visit = (node: ts.Node): void => {
    if (visited.has(node)) return;
    visited.add(node);
    if ([ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.JSDocAllType, ts.SyntaxKind.JSDocUnknownType].includes(node.kind)) {
      report('explicit_any', node.getStart(source));
    }
    if (ts.isNonNullExpression(node)
      || ((ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) && node.exclamationToken)) {
      report('non_null_assertion', node.getStart(source));
    }
    if ((assertion(node) || (ts.isParenthesizedExpression(node) && ts.getJSDocType(node)))
      && assertionDepth(node) > 1) {
      report('double_assertion', node.getStart(source));
    }
    // JSDoc 类型也是受检源码的一部分，forEachChild 不会遍历这些节点。
    for (const doc of ts.getJSDocCommentsAndTags(node)) visit(doc);
    ts.forEachChild(node, visit);
  };
  visit(source);
  // parser 提供的 token 保留 JSX/正则/模板上下文，也能覆盖空容器内的 trivia。
  const collectComments = (node: ts.Node): void => {
    if (ts.isJsxText(node)) return;
    const children = node.getChildren(source);
    if (children.length) {
      for (const child of children) collectComments(child);
    } else {
      for (const range of [
        ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.getFullStart()) ?? []),
      ]) comments.set(range.pos, range);
    }
  };
  collectComments(source);
  for (const range of comments.values()) {
    const comment = text.slice(range.pos, range.end);
    if (/@ts-(?:ignore|nocheck)\b|\beslint-disable\b|\bbiome-(?:disable|ignore)\b/.test(comment)) {
      report('suppressed_check', range.pos);
    }
    if (/@ts-expect-error\b/.test(comment)) {
      const reason = comment.split('@ts-expect-error')[1]?.replace(/\*\/$/, '').replace(/^[:\s]+/, '').trim();
      if (!TYPE_ERROR_FIXTURES.has(normalizedFile) || !reason) report('suppressed_check', range.pos);
    }
  }
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, noEmit: true, allowJs: true, jsx: ts.JsxEmit.Preserve };
  const program = ts.createProgram([normalizedFile], options, {
    ...ts.createCompilerHost(options),
    getSourceFile: name => name === normalizedFile ? source : undefined,
  });
  for (const diagnostic of program.getSyntacticDiagnostics(source)) report('syntax_error', diagnostic.start ?? 0);
  return issues;
}

const REQUIRED_TRUE = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'noPropertyAccessFromIndexSignature',
  'noFallthroughCasesInSwitch',
] as const;

export function inspectStrictOptions(options: ts.CompilerOptions): string[] {
  const issues: string[] = REQUIRED_TRUE.filter(option => options[option] !== true);
  if (options.skipLibCheck !== false) issues.push('skipLibCheck must be false');
  if (options.noCheck) issues.push('noCheck disables checking');
  if (options.skipDefaultLibCheck) issues.push('skipDefaultLibCheck disables declaration checking');
  if (options.allowJs && options.checkJs !== true) issues.push('allowJs requires checkJs');
  for (const option of [
    'noImplicitAny', 'strictNullChecks', 'strictFunctionTypes', 'strictBindCallApply',
    'strictPropertyInitialization', 'noImplicitThis', 'useUnknownInCatchVariables', 'alwaysStrict', 'strictBuiltinIteratorReturn',
  ] as const) {
    if (options[option] === false) issues.push(`${option} overrides strict`);
  }
  return issues;
}
