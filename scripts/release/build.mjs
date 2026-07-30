import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collectTargetIntegrity } from "./integrity.mjs";
import { releaseManifestPath, releaseOutputRoot, repositoryRoot, targetOutputDir } from "./paths.mjs";

const requestedTarget = process.argv[2];
const targets = requestedTarget === "release" ? ["formal", "preview"] : [requestedTarget];

if (!targets.every((target) => target === "formal" || target === "preview")) {
  throw new Error("Usage: node scripts/release/build.mjs <formal|preview|release>");
}

assertCleanSourceTree();

const viteBin = path.resolve(repositoryRoot, "node_modules/vite/bin/vite.js");
const verifyScript = fileURLToPath(new URL("./verify.mjs", import.meta.url));
const appVersion = readGitVersion();

await rm(releaseOutputRoot, { recursive: true, force: true });

for (const target of targets) {
  const outputDir = targetOutputDir(target);
  const result = spawnSync(process.execPath, [viteBin, "build"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      VITE_APP_VERSION: appVersion,
      VITE_COS_ENABLED: process.env.VITE_COS_ENABLED || "1",
      VITE_RELEASE_TARGET: target,
      VITE_OUTPUT_DIR: outputDir
    },
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const verifyResult = spawnSync(process.execPath, [verifyScript, ...targets], {
  cwd: repositoryRoot,
  env: { ...process.env, RELEASE_VERSION: appVersion },
  stdio: "inherit"
});

if (verifyResult.status !== 0) {
  process.exit(verifyResult.status ?? 1);
}

if (requestedTarget === "release") {
  const integrity = {};
  for (const target of targets) {
    integrity[target] = await collectTargetIntegrity(targetOutputDir(target));
  }
  await writeFile(
    releaseManifestPath,
    `${JSON.stringify({ schemaVersion: 1, appVersion, targets, integrity }, null, 2)}\n`,
    "utf8"
  );
}

console.log(`Release ${appVersion} artifacts: ${releaseOutputRoot}`);

function readGitVersion() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  const version = result.stdout?.trim();
  if (result.status !== 0 || !version) {
    throw new Error(`Unable to determine release version: ${result.stderr?.trim() || "git failed"}`);
  }
  return version;
}

function assertCleanSourceTree() {
  if (process.env.ALLOW_DIRTY_RELEASE === "1") return;
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error("Unable to inspect the Git worktree before release");
  if (result.stdout.trim()) throw new Error("Release builds require a clean Git worktree");
}
