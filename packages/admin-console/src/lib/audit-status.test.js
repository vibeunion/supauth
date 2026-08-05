import { describe, expect, test } from "bun:test";
import {
  auditExportStatusLabelKey,
  auditIntegrityStatusLabelKey,
} from "./audit-status.js";

describe("audit status labels", () => {
  test("maps integrity states without exposing unknown upstream values", () => {
    expect(auditIntegrityStatusLabelKey({ consistent: true, status: "verified" }))
      .toBe("audit.integrityStatus.verified");
    expect(auditIntegrityStatusLabelKey({ consistent: false, status: "mismatch" }))
      .toBe("audit.integrityStatus.mismatch");
    expect(auditIntegrityStatusLabelKey({ consistent: false, status: "legacy_unverified" }))
      .toBe("audit.integrityStatus.legacyUnverified");
    expect(auditIntegrityStatusLabelKey({ consistent: false, status: "verified" }))
      .toBe("audit.integrityStatus.reviewRequired");
    expect(auditIntegrityStatusLabelKey({ consistent: false, status: "future_status" }))
      .toBe("audit.integrityStatus.reviewRequired");
    expect(auditIntegrityStatusLabelKey({ consistent: false, status: "toString" }))
      .toBe("audit.integrityStatus.reviewRequired");
  });

  test("maps export states without exposing unknown upstream values", () => {
    expect(auditExportStatusLabelKey("completed")).toBe("audit.exportStatus.completed");
    expect(auditExportStatusLabelKey("future_status")).toBe("audit.exportStatus.unknown");
    expect(auditExportStatusLabelKey("constructor")).toBe("audit.exportStatus.unknown");
  });
});
