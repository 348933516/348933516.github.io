type ImportStorageAsset = {
  originalPath: string;
  displayPath: string;
  imageVariants?: Array<{ path: string }>;
};

export function importStoragePrefix(importId: string) {
  return `imports/${importId}/`;
}

export function expectedImportStoragePaths(assets: ImportStorageAsset[]) {
  return [...new Set(assets.flatMap((asset) => [
    asset.originalPath,
    asset.displayPath,
    ...(asset.imageVariants || []).map((variant) => variant.path)
  ]).filter(Boolean))];
}

export function compareImportStoragePaths(expectedPaths: string[], storedPaths: string[]) {
  const presentPaths = new Set(storedPaths);
  return {
    expectedCount: expectedPaths.length,
    foundCount: expectedPaths.filter((path) => presentPaths.has(path)).length,
    missingPaths: expectedPaths.filter((path) => !presentPaths.has(path))
  };
}
