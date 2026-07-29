import { describe, expect, it } from "vitest";
import { managedUploadPrefix } from "./uploads";

describe("managed COS upload scopes", () => {
  it("reuses one credential scope for every image in a Word import", () => {
    const first = managedUploadPrefix({
      purpose: "document-import",
      importId: "11111111-1111-4111-8111-111111111111",
      path: "imports/11111111-1111-4111-8111-111111111111/001-original.png"
    });
    const last = managedUploadPrefix({
      purpose: "document-import",
      importId: "11111111-1111-4111-8111-111111111111",
      path: "imports/11111111-1111-4111-8111-111111111111/098-1600.webp"
    });
    expect(first).toBe("imports/11111111-1111-4111-8111-111111111111/");
    expect(last).toBe(first);
  });

  it("keeps draft and public content credentials in separate scopes", () => {
    const contentId = "22222222-2222-4222-8222-222222222222";
    expect(managedUploadPrefix({ purpose: "content-media", contentId, path: `drafts/${contentId}/media/a.webp` })).toBe(`drafts/${contentId}/`);
    expect(managedUploadPrefix({ purpose: "content-media", contentId, path: `content/${contentId}/inline/a.webp` })).toBe(`content/${contentId}/`);
  });

  it("uses a stable top-level scope while migrating existing objects", () => {
    expect(managedUploadPrefix({ purpose: "migration", path: "imports/job/image.webp" })).toBe("imports/");
    expect(managedUploadPrefix({ purpose: "migration", path: "site/carousel/banner.webp" })).toBe("site/");
  });
});
