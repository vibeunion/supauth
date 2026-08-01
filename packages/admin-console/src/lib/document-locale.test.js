import { describe, expect, it } from "bun:test";
import {
  resolveDocumentLocale,
  syncDocumentLocale,
} from "./document-locale.js";

describe("document locale", () => {
  it("resolves Chinese and English browser locale candidates", () => {
    expect(resolveDocumentLocale(["zh_CN", "en-US"])).toBe("zh-CN");
    expect(resolveDocumentLocale(["fr-FR", "en-US"])).toBe("en");
  });

  it("updates the document language after each locale change", () => {
    const documentElement = { lang: "en" };

    syncDocumentLocale(documentElement, "zh-CN");
    expect(documentElement.lang).toBe("zh-CN");

    syncDocumentLocale(documentElement, "en");
    expect(documentElement.lang).toBe("en");
  });

  it("is safe when server-side rendering has no document", () => {
    expect(() => syncDocumentLocale(undefined, "zh-CN")).not.toThrow();
  });
});
