import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const webhookPage = readFileSync(
  new URL("../routes/webhooks/+page.svelte", import.meta.url),
  "utf8",
);
const script = webhookPage.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Missing webhook page script");
const compiledScript = ts.transpileModule(script, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText;
const syntax = ts.createSourceFile("webhooks.js", compiledScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const replayDeclaration = syntax.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "replayLastLocked",
);
if (!replayDeclaration || !ts.isFunctionDeclaration(replayDeclaration) || !replayDeclaration.body) {
  throw new Error("Missing replayLastLocked declaration");
}
const replaySource = replayDeclaration.getText(syntax);

describe("webhook replay lock rendering", () => {
  test("does not validate a replay lock descriptor before a delivery exists", () => {
    expect(replaySource).toContain("function replayLastLocked(whId)");
    expect(replaySource).toContain(
      'return resourceId ? webhookMutationLocked("replay", resourceId) : false;',
    );
    expect(webhookPage).toContain("replayLastLocked(wh.id)");

    const invoke = new Function("replayResourceIdForLast", "webhookMutationLocked", `${replaySource}; return replayLastLocked("webhook-1");`);
    /** @type {[string, string][]} */
    const descriptors = [];
    /** @param {string} action @param {string} resourceId */
    const locked = (action, resourceId) => {
      descriptors.push([action, resourceId]);
      return true;
    };
    expect(invoke(() => "", locked)).toBe(false);
    expect(descriptors).toEqual([]);
    expect(invoke(() => "webhook-1:delivery-1", locked)).toBe(true);
    expect(descriptors).toEqual([["replay", "webhook-1:delivery-1"]]);
    expect(invoke(() => "webhook-1:delivery-1", () => false)).toBe(false);
  });

  test("renders list failures through the localized request state", () => {
    expect(webhookPage).toContain(
      'import RequestState from "$lib/components/RequestState.svelte";',
    );
    expect(compiledScript).toContain("let loadError = $state(null);");
    expect(compiledScript).toContain("loadError = requestError;");
    expect(compiledScript).not.toContain("loadError = requestError.message;");
    expect(webhookPage).toContain("error={loadError}");
    expect(webhookPage).toContain("onRetry={load}");
  });
});
