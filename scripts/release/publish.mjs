import { access, cp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { releaseManifestPath, repositoryRoot, targetOutputDir } from "./paths.mjs";

const allowedFormalEntries = new Set(["assets", "favicon.svg", "ffmpeg", "index.html", "manifest.webmanifest"]);
const publishRoot = path.resolve(process.env.RELEASE_PUBLISH_ROOT || repositoryRoot);
const verifyScript = fileURLToPath(new URL("./verify.mjs", import.meta.url));
const releaseManifest = JSON.parse(await readFile(releaseManifestPath, "utf8"));
const currentVersion = readGitVersion();

assertCleanSourceTree();
if (publishRoot !== repositoryRoot && process.env.ALLOW_EXTERNAL_PUBLISH_ROOT !== "1") {
  throw new Error(`Refusing to publish outside the repository: ${publishRoot}`);
}

if (releaseManifest.schemaVersion !== 1 || releaseManifest.appVersion !== currentVersion) {
  throw new Error("Release artifacts were not built from the current Git commit");
}
if (JSON.stringify([...releaseManifest.targets].sort()) !== JSON.stringify(["formal", "preview"])) {
  throw new Error("publish:release requires a verified build:release with both targets");
}

const verifyResult = spawnSync(process.execPath, [verifyScript, "formal", "preview"], {
  cwd: repositoryRoot,
  env: { ...process.env, RELEASE_VERSION: currentVersion },
  stdio: "inherit"
});
if (verifyResult.status !== 0) process.exit(verifyResult.status ?? 1);

const formalSource = targetOutputDir("formal");
const previewSource = targetOutputDir("preview");
const formalEntries = await readdir(formalSource);
const unexpectedEntries = formalEntries.filter((entry) => !allowedFormalEntries.has(entry) && entry !== ".vite");
if (unexpectedEntries.length > 0) {
  throw new Error(`Refusing to publish unknown formal artifacts: ${unexpectedEntries.join(", ")}`);
}

const transactionRoot = path.join(publishRoot, `.release-publish-${process.pid}`);
const stageRoot = path.join(transactionRoot, "stage");
const backupRoot = path.join(transactionRoot, "backup");
const movedDestinations = [];
const backedUpDestinations = [];

assertInside(publishRoot, transactionRoot);
await rm(transactionRoot, { recursive: true, force: true });
await mkdir(path.join(stageRoot, "formal"), { recursive: true });
await mkdir(backupRoot, { recursive: true });

for (const entry of formalEntries.filter((name) => allowedFormalEntries.has(name))) {
  await cp(path.join(formalSource, entry), path.join(stageRoot, "formal", entry), { recursive: true });
}
await cp(previewSource, path.join(stageRoot, "preview"), { recursive: true });

try {
  for (const entry of [...allowedFormalEntries, "preview"]) {
    const destination = path.join(publishRoot, entry);
    const backup = path.join(backupRoot, entry);
    assertInside(publishRoot, destination);
    if (await exists(destination)) {
      await mkdir(path.dirname(backup), { recursive: true });
      await rename(destination, backup);
      backedUpDestinations.push({ destination, backup });
    }
  }

  for (const entry of formalEntries.filter((name) => allowedFormalEntries.has(name))) {
    const source = path.join(stageRoot, "formal", entry);
    const destination = path.join(publishRoot, entry);
    await rename(source, destination);
    movedDestinations.push(destination);
  }
  const previewDestination = path.join(publishRoot, "preview");
  await rename(path.join(stageRoot, "preview"), previewDestination);
  movedDestinations.push(previewDestination);
} catch (error) {
  for (const destination of movedDestinations.reverse()) {
    await rm(destination, { recursive: true, force: true });
  }
  for (const { destination, backup } of backedUpDestinations.reverse()) {
    if (await exists(backup)) await rename(backup, destination);
  }
  throw error;
} finally {
  await rm(transactionRoot, { recursive: true, force: true });
}

console.log(`Published release ${currentVersion} to ${publishRoot}`);

function readGitVersion() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
  const version = result.stdout?.trim();
  if (result.status !== 0 || !version) throw new Error("Unable to determine current Git commit");
  return version;
}

function assertCleanSourceTree() {
  if (process.env.ALLOW_DIRTY_RELEASE === "1") return;
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to inspect the Git worktree before publish");
  if (result.stdout.trim()) throw new Error("Publishing requires a clean Git worktree");
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe publish path: ${target}`);
  }
}
