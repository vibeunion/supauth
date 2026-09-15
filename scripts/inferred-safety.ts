import ts from 'typescript';

export interface InferredSafetyIssue {
  file: string;
  line: number;
  column: number;
  code: 'any_binding' | 'any_return' | 'promise_any_return';
}

/** 检查维护源的顶层推导结果；不把第三方内部类型或深层对象图算作已证明安全。 */
export function inspectInferredSafety(program: ts.Program, files: ReadonlySet<string>): InferredSafetyIssue[] {
  const checker = program.getTypeChecker();
  const issues = new Map<string, InferredSafetyIssue>();
  for (const source of program.getSourceFiles()) {
    if (!files.has(source.fileName)) continue;
    const report = (node: ts.Node, code: InferredSafetyIssue['code']): void => {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      const issue = { file: source.fileName, line: position.line + 1, column: position.character + 1, code };
      issues.set(`${issue.file}:${issue.line}:${issue.column}:${issue.code}`, issue);
    };
    const inspectBinding = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) {
        if (checker.getTypeAtLocation(name).flags & ts.TypeFlags.Any) report(name, 'any_binding');
      } else {
        for (const element of name.elements) if (!ts.isOmittedExpression(element)) inspectBinding(element.name);
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node)) inspectBinding(node.name);
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)
        || ts.isFunctionExpression(node) || ts.isGetAccessor(node)) {
        const signature = checker.getSignatureFromDeclaration(node);
        if (signature) {
          const result = checker.getReturnTypeOfSignature(signature);
          if (result.flags & ts.TypeFlags.Any) report(node, 'any_return');
          const awaited = checker.getAwaitedType(result);
          if (!(result.flags & ts.TypeFlags.Any) && awaited && awaited.flags & ts.TypeFlags.Any) {
            report(node, 'promise_any_return');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...issues.values()];
}
