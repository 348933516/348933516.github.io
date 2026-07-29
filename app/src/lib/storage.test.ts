import { describe, expect, it } from "vitest";
import { edgeMediaUrl, encodeStoragePath, publicStorageUrl, storedAssetUrl } from "./storage";

describe("provider-aware storage URLs", () => {
  it("encodes each COS object path segment without losing directories", () => {
    expect(encodeStoragePath("imports/task id/原图 1.png")).toBe("imports/task%20id/%E5%8E%9F%E5%9B%BE%201.png");
  });

  it("serves Tencent COS objects through the EdgeOne media domain", () => {
    expect(edgeMediaUrl("content/item/image.webp")).toBe("https://media.maplestorynk.online/content/item/image.webp");
    expect(storedAssetUrl("site/carousel/banner.webp", "tencent_cos")).toBe("https://media.maplestorynk.online/site/carousel/banner.webp");
  });

  it("keeps legacy Supabase public objects readable during migration", () => {
    const url = publicStorageUrl({ provider: "supabase", bucket: "maplestorynk-public", path: "imports/old/image.png" });
    expect(url).toContain("/storage/v1/object/public/maplestorynk-public/imports/old/image.png");
  });

  it("does not expose private objects as public URLs", () => {
    expect(publicStorageUrl({ provider: "supabase", bucket: "maplestorynk-private", path: "drafts/private.png" })).toBe("");
    expect(publicStorageUrl({ provider: "tencent_cos", bucket: "maplestorynk-private-1331200863", path: "drafts/private.png" })).toBe("");
  });
});
