import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function collectTargetIntegrity(rootDir) {
  const files = await listFiles(rootDir);
  return Promise.all(
    files.map(async (relativePath) => ({
      path: relativePath,
      sha256: createHash("sha256").update(await readFile(path.join(rootDir, relativePath))).digest("hex")
    }))
  );
}

async function listFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootDir, absolutePath)));
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, absolutePath).split(path.sep).join("/"));
    }
  }
  return files;
}
