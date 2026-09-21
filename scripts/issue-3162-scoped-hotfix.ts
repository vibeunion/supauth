import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';

const approvedSources = new Set([
  '2f4b20a711bd8cc27b3d0ddb2235d899b8cbbe2b23e13733b3f1e2e1a2fccf6f',
  '30224c17c16ff2c8d357639f4416af9ad6f91436ef4b882644c3e86c807a9a84',
]);

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`Hotfix anchor is not unique: ${before.slice(0, 80)}`);
  return source.replace(before, () => after);
}

export function authorizationHtml(source: string): string {
  const file = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true);
  let html: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'EMBEDDED_AUTHORIZE_HTML'
      && node.initializer && ts.isStringLiteralLike(node.initializer)) html = node.initializer.text;
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!html) throw new Error('Missing embedded authorize HTML');
  return html;
}

export function patchAuthorizationHtml(html: string): string {
  let result = replaceOnce(html, "let authorizationAccessToken = '';",
    "let authorizationAccessToken = '';\n      let authorizationUnavailable = false;");
  result = replaceOnce(result, "authorizationFailed: 'Authorization approval failed',",
    "authorizationFailed: 'Authorization approval failed',\n      authorizationRestart: 'This sign-in request is no longer available. Return to the application and start sign-in again.',\n      authorizationBack: 'Back to previous page',");
  result = replaceOnce(result, "authorizationFailed: '授权确认失败',",
    "authorizationFailed: '授权确认失败',\n      authorizationRestart: '本次登录请求已失效，请返回应用重新发起登录，不要在此页面重复提交。',\n      authorizationBack: '返回上一页',");
  result = replaceOnce(result, 'async function authorizationRequest(path, accessToken, options = {}) {',
    `async function authorizationRequest(path, accessToken, options = {}) {
        if (authorizationUnavailable) throw new Error(t('authorizationRestart'));`);
  result = replaceOnce(result, "throw createApiError(data, t('authorizationFailed'));", `
          if (res.status === 404 && apiErrorCode(data) === 'oauth_authorization_not_found') {
            authorizationUnavailable = true;
            authorizationAccessToken = '';
            document.getElementById('password').value = '';
            for (const id of ['submit', 'consent-approve', 'consent-deny']) {
              document.getElementById(id).disabled = true;
            }
            if (window.history.length > 1 && !document.getElementById('authorization-back')) {
              const back = document.createElement('button');
              back.id = 'authorization-back';
              back.type = 'button';
              back.textContent = t('authorizationBack');
              back.addEventListener('click', () => window.history.back());
              document.getElementById('message').after(back);
            }
            throw new Error(t('authorizationRestart'));
          }
          throw createApiError(data, t('authorizationFailed'));`);
  result = replaceOnce(result, 'approveButton.disabled = false;', 'approveButton.disabled = authorizationUnavailable;');
  result = replaceOnce(result, 'denyButton.disabled = false;', 'denyButton.disabled = authorizationUnavailable;');
  const loginStart = "document.getElementById('login-form').addEventListener('submit', async (event) => {";
  result = replaceOnce(result, `${loginStart}\n        event.preventDefault();`, `${loginStart}
        event.preventDefault();
        if (authorizationUnavailable) {
          setMessage('error', t('authorizationRestart'));
          return;
        }`);
  const start = result.indexOf(loginStart);
  const end = result.indexOf("document.getElementById('signup-form')", start);
  if (start < 0 || end < 0) throw new Error('Missing login form boundary');
  result = result.slice(0, start)
    + replaceOnce(result.slice(start, end), 'button.disabled = false;', 'button.disabled = authorizationUnavailable;')
    + result.slice(end);
  return replaceOnce(result, '      init();', `      void init().catch((error) => {
        setMessage('error', responseMessage(error, t('authorizationFailed')));
      });`);
}

export function patchLiveSource(source: string): string {
  const digest = createHash('sha256').update(source).digest('hex');
  if (!approvedSources.has(digest)) throw new Error('Source does not match an approved live version');
  const file = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'EMBEDDED_AUTHORIZE_HTML'
      && node.initializer && ts.isStringLiteralLike(node.initializer)) {
      replacements.push({
        start: node.initializer.getStart(file), end: node.initializer.end,
        text: JSON.stringify(patchAuthorizationHtml(node.initializer.text)),
      });
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'fetchGoTrueJson') {
      replacements.push({
        start: node.getStart(file), end: node.end,
        text: replaceOnce(node.getText(file),
          'if (directInternal && index2 === 0 && response.status === 404) {',
          'if (directInternal && index2 === 0 && response.status === 404 && !isOAuthAuthorizationNotFound(response.status, payload)) {'),
      });
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'goTrueOAuthPayload') {
      replacements.push({
        start: node.getStart(file), end: node.end,
        text: replaceOnce(node.getText(file),
          'const failure = upstreamResponseFailure(result.response.status, badRequest);',
          `if (isOAuthAuthorizationNotFound(result.response.status, result.payload)) {
    set.status = 404;
    return {
      error: "oauth_authorization_not_found",
      error_description: "This sign-in request is no longer available. Please return to the application and sign in again."
    };
  }
  const failure = upstreamResponseFailure(result.response.status, badRequest);`),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (replacements.length !== 3) throw new Error('Hotfix must change exactly two functions and one hosted page');
  let result = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  const helper = readFileSync(new URL('../packages/auth-server/src/utils/oauth-authorization-failure.ts', import.meta.url), 'utf8');
  return result + '\n' + ts.transpileModule(helper.replace('export function', 'function'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

export function prepareLiveBundle(originalDirectory: string, runtimeSource: string, outputDirectory: string) {
  if (existsSync(outputDirectory)) throw new Error('Candidate directory must not already exist');
  const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  if (sha256(readFileSync(join(originalDirectory, 'index.ts'))) !== 'c29372921b663d38c3a6ed11ad28819ce8470aa7a5977b87e121e61afd383846') {
    throw new Error('Original source entrypoint does not match the exported releases');
  }
  const beforeHtml = readFileSync(join(originalDirectory, 'admin-console/build/authorize.html'), 'utf8');
  if (beforeHtml !== authorizationHtml(runtimeSource)) throw new Error('Static and embedded hosted pages differ');
  const index = patchLiveSource(runtimeSource);
  const html = patchAuthorizationHtml(beforeHtml);
  const files: Array<{ path: string; beforeSha256: string; afterSha256: string; changed: boolean }> = [];
  function copy(relativeDirectory: string) {
    for (const name of readdirSync(join(originalDirectory, relativeDirectory))) {
      const relative = join(relativeDirectory, name);
      const source = join(originalDirectory, relative);
      const stat = lstatSync(source);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Unsupported file: ${relative}`);
      if (stat.isDirectory()) {
        copy(relative);
        continue;
      }
      // 平台生成入口属于上次运行产物，部署器会重新生成，不能作为源文件上传。
      if (relative === '.supacloud-entry.js') continue;
      const before = readFileSync(source);
      const content = relative === 'index.ts' ? Buffer.from(index)
        : relative === 'admin-console/build/authorize.html' ? Buffer.from(html) : before;
      const target = join(outputDirectory, relative);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { flag: 'wx' });
      files.push({ path: relative, beforeSha256: sha256(before), afterSha256: sha256(content), changed: !before.equals(content) });
    }
  }
  copy('');
  const changed = files.filter(file => file.changed).map(file => file.path).sort();
  if (JSON.stringify(changed) !== JSON.stringify(['admin-console/build/authorize.html', 'index.ts'])) {
    throw new Error('Bundle scope must contain exactly the entrypoint and authorize page');
  }
  return { sourceSha256: sha256(runtimeSource), generatedEntrypointExcluded: '.supacloud-entry.js', changed, files };
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: issue-3162-scoped-hotfix.ts INPUT OUTPUT');
  const source = patchLiveSource(readFileSync(input, 'utf8'));
  // 只生成新制品，不覆盖线上版本备份；调用者负责精确版本部署和回读。
  writeFileSync(output, source, { flag: 'wx' });
  console.log(JSON.stringify({ output, sha256: createHash('sha256').update(source).digest('hex') }));
}
