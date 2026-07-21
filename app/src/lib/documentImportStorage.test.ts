import { describe, expect, it } from "vitest";
import {
  compareImportStoragePaths,
  expectedImportStoragePaths,
  importStoragePrefix
} from "../../../supabase/functions/document-import/storage";

function importAssets(count: number) {
  return Array.from({ length: count }, (_, offset) => {
    const index = String(offset + 1).padStart(3, "0");
    const prefix = importStoragePrefix("00000000-0000-4000-8000-000000000099");
    return {
      originalPath: `${prefix}${index}-original.png`,
      displayPath: `${prefix}${index}-1600.webp`,
      imageVariants: [
        { path: `${prefix}${index}-960.webp` },
        { path: `${prefix}${index}-1600.webp` }
      ]
    };
  });
}

describe("document import storage verification", () => {
  it("verifies all 294 objects from a 98-image import without a long IN filter", () => {
    const expected = expectedImportStoragePaths(importAssets(98));
    expect(expected).toHaveLength(294);
    expect(compareImportStoragePaths(expected, expected)).toEqual({
      expectedCount: 294,
      foundCount: 294,
      missingPaths: []
    });
  });

  it("reports only the exact object that is absent", () => {
    const expected = expectedImportStoragePaths(importAssets(98));
    const missing = expected[173];
    const stored = expected.filter((path) => path !== missing);

    expect(compareImportStoragePaths(expected, stored)).toEqual({
      expectedCount: 294,
      foundCount: 293,
      missingPaths: [missing]
    });
  });
});
