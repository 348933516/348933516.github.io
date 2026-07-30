import os from "node:os";
import path from "node:path";
import { access, appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { releaseOutputRoot, repositoryRoot } from "./paths.mjs";

const publishScript = fileURLToPath(new URL("./publish.mjs", import.meta.url));
const publishRoot = await mkdtemp(path.join(os.tmpdir(), "maplestorynk-publish-test-"));
const tamperedParent = await mkdtemp(path.join(os.tmpdir(), "maplestorynk-release-tampered-"));
const tamperedReleaseRoot = path.join(tamperedParent, "release");
const rejectedPublishRoot = await mkdtemp(path.join(os.tmpdir(), "maplestorynk-publish-rejected-"));

try {
  await Promise.all([
    mkdir(path.join(publishRoot, "app")),
    mkdir(path.join(publishRoot, "assets")),
    mkdir(path.join(publishRoot, "preview"))
  ]);
  await Promise.all([
    writeFile(path.join(publishRoot, "app", "source-sentinel.txt"), "keep\n"),
    writeFile(path.join(publishRoot, "keep.txt"), "keep\n"),
    writeFile(path.join(publishRoot, "assets", "old.js"), "old\n"),
    writeFile(path.join(publishRoot, "preview", "old.js"), "old\n")
  ]);

  const publishResult = runPublish(releaseOutputRoot, publishRoot);
  assert(publishResult.status === 0, publishResult.stderr || "guarded publish failed");
  await Promise.all([
    access(path.join(publishRoot, "app", "source-sentinel.txt")),
    access(path.join(publishRoot, "keep.txt"))
  ]);
  assert(!(await exists(path.join(publishRoot, "assets", "old.js"))), "old root asset was not replaced");
  assert(!(await exists(path.join(publishRoot, "preview", "old.js"))), "old preview asset was not replaced");
  assert((await readFile(path.join(publishRoot, "index.html"), "utf8")).includes("/assets/"), "formal base is wrong");
  assert(
    (await readFile(path.join(publishRoot, "preview", "index.html"), "utf8")).includes("/preview/assets/"),
    "preview base is wrong"
  );
  assert(
    !(await readdir(publishRoot)).some((name) => name.startsWith(".release-publish-")),
    "publish transaction residue remains"
  );

  await cp(releaseOutputRoot, tamperedReleaseRoot, { recursive: true });
  await appendFile(path.join(tamperedReleaseRoot, "formal", "index.html"), "<!-- tampered -->\n");
  const rejectedResult = runPublish(tamperedReleaseRoot, rejectedPublishRoot);
  assert(rejectedResult.status !== 0, "tampered artifacts were accepted");
  assert(
    `${rejectedResult.stdout}\n${rejectedResult.stderr}`.includes("artifacts changed after release verification"),
    "tamper rejection did not report the integrity failure"
  );

  console.log("Guarded release publish tests passed");
} finally {
  await Promise.all([
    rm(publishRoot, { recursive: true, force: true }),
    rm(tamperedParent, { recursive: true, force: true }),
    rm(rejectedPublishRoot, { recursive: true, force: true })
  ]);
}

function runPublish(outputRoot, destinationRoot) {
  return spawnSync(process.execPath, [publishScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      RELEASE_OUTPUT_DIR: outputRoot,
      RELEASE_PUBLISH_ROOT: destinationRoot,
      ALLOW_DIRTY_RELEASE: "1",
      ALLOW_EXTERNAL_PUBLISH_ROOT: "1"
    },
    encoding: "utf8"
  });
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
