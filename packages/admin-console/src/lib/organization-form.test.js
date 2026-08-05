import { describe, expect, test } from "bun:test";
import {
  organizationDraft,
  organizationSlugIssue,
} from "./organization-form.js";

const ORGANIZATION_SLUG_CASES = [
  { label: "empty", slug: "", issue: "required" },
  { label: "one character", slug: "a", issue: "length" },
  { label: "two characters", slug: "ab", issue: null },
  { label: "120 characters", slug: "a".repeat(120), issue: null },
  { label: "121 characters", slug: "a".repeat(121), issue: "length" },
  { label: "Chinese", slug: "西谷", issue: "format" },
  { label: "leading hyphen", slug: "-xigu", issue: "format" },
  { label: "trailing hyphen", slug: "xigu-", issue: "format" },
  { label: "consecutive hyphens", slug: "xigu--zhiji", issue: "format" },
  { label: "segmented slug", slug: "xigu-zhiji", issue: null },
];

describe("Organization form", () => {
  for (const { label, slug, issue } of ORGANIZATION_SLUG_CASES) {
    test(`classifies ${label}`, () => {
      expect(organizationSlugIssue(slug)).toBe(issue);
    });
  }

  test("keeps a Chinese name and includes the explicit slug in the payload", () => {
    expect(
      organizationDraft({
        name: "  测试组织  ",
        slug: "  xigu-zhiji  ",
        description: "任意描述",
      }),
    ).toEqual({
      name: "测试组织",
      slug: "xigu-zhiji",
      description: "任意描述",
    });
  });
});
