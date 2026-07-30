import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const releaseOutputRoot = path.resolve(
  process.env.RELEASE_OUTPUT_DIR || path.join(os.tmpdir(), "maplestorynk-release")
);

const temporaryRoot = path.resolve(os.tmpdir());
const temporaryRelative = path.relative(temporaryRoot, releaseOutputRoot);
if (!temporaryRelative || temporaryRelative.startsWith("..") || path.isAbsolute(temporaryRelative)) {
  throw new Error(`Unsafe RELEASE_OUTPUT_DIR: ${releaseOutputRoot}`);
}

export const releaseManifestPath = path.join(releaseOutputRoot, "release-manifest.json");

export function targetOutputDir(target) {
  return path.join(releaseOutputRoot, target);
}
