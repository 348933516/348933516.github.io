import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { collectTargetIntegrity } from "./integrity.mjs";
import { releaseManifestPath, releaseOutputRoot, targetOutputDir } from "./paths.mjs";

const requestedTargets = process.argv.slice(2);
const targets = requestedTargets.length > 0 ? requestedTargets : ["formal", "preview"];

if (!targets.every((target) => target === "formal" || target === "preview")) {
  throw new Error("Targets must be formal or preview");
}

const manifests = new Map();
const releaseManifest = await readReleaseManifest();
const expectedVersion = process.env.RELEASE_VERSION || releaseManifest?.appVersion;

for (const target of targets) {
  const outputDir = targetOutputDir(target);
  const indexPath = path.join(outputDir, "index.html");
  const manifestPath = path.join(outputDir, ".vite", "manifest.json");
  const webManifestPath = path.join(outputDir, "manifest.webmanifest");

  await Promise.all([access(indexPath), access(manifestPath), access(webManifestPath)]);

  const [html, manifestText, assetNames] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(manifestPath, "utf8"),
    readdir(path.join(outputDir, "assets"))
  ]);
  const manifest = JSON.parse(manifestText);
  manifests.set(target, manifest);

  assert(Object.keys(manifest).some((key) => key.replaceAll("\\", "/").endsWith("src/lib/cosUpload.ts")), `${target}: COS upload module is missing`);
  assert(assetNames.some((name) => name.startsWith("cosUpload-") && name.endsWith(".js")), `${target}: COS upload chunk is missing`);

  const expectedAssetPrefix = target === "formal" ? "/assets/" : "/preview/assets/";
  const forbiddenAssetPrefix = target === "formal" ? "/preview/assets/" : 'src="/assets/';
  const hasIndexingBlock = /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/.test(html);

  assert(html.includes(expectedAssetPrefix), `${target}: index does not use ${expectedAssetPrefix}`);
  assert(!html.includes(forbiddenAssetPrefix), `${target}: index contains the other target's asset base`);
  assert(target === "preview" ? hasIndexingBlock : !hasIndexingBlock, `${target}: robots policy is incorrect`);
  assert(html.includes('rel="dns-prefetch" href="//media.maplestorynk.online"'), `${target}: DNS prefetch is missing`);
  assert(html.includes('rel="preconnect" href="https://media.maplestorynk.online"'), `${target}: media preconnect is missing`);

  const entry = Object.values(manifest).find((item) => item.isEntry);
  assert(entry, `${target}: Vite entry is missing from the manifest`);
  assert(entry.file.startsWith("assets/"), `${target}: entry is not emitted under assets/`);

  const codeAssets = assetNames.filter((name) => name.endsWith(".js") || name.endsWith(".css"));
  assert(codeAssets.length > 0, `${target}: no JavaScript or CSS assets were emitted`);
  for (const assetName of codeAssets) {
    const assetPath = path.join(outputDir, "assets", assetName);
    const assetStat = await stat(assetPath);
    assert(assetStat.size > 0, `${target}: ${assetName} is empty`);
    assert(/-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(assetName), `${target}: ${assetName} is not hash-named`);
  }

  if (expectedVersion) {
    const javaScript = await Promise.all(
      codeAssets.filter((name) => name.endsWith(".js")).map((name) => readFile(path.join(outputDir, "assets", name), "utf8"))
    );
    assert(javaScript.some((contents) => contents.includes(expectedVersion)), `${target}: VITE_APP_VERSION is missing`);
  }
}

if (manifests.has("formal") && manifests.has("preview")) {
  const moduleGraph = (manifest) => Object.values(manifest).map((item) => ({
    identity: item.src || item.name,
    isEntry: Boolean(item.isEntry),
    isDynamicEntry: Boolean(item.isDynamicEntry),
    imports: item.imports?.length || 0,
    dynamicImports: item.dynamicImports?.length || 0,
    css: item.css?.length || 0
  })).sort((left, right) => String(left.identity).localeCompare(String(right.identity)));
  const formalGraph = moduleGraph(manifests.get("formal"));
  const previewGraph = moduleGraph(manifests.get("preview"));
  assert(
    JSON.stringify(formalGraph) === JSON.stringify(previewGraph),
    "formal and preview builds do not contain the same module graph"
  );
}

if (releaseManifest) {
  assert(releaseManifest.schemaVersion === 1, "release manifest schema is unsupported");
  assert(
    JSON.stringify([...releaseManifest.targets].sort()) === JSON.stringify([...targets].sort()),
    "release manifest targets do not match requested targets"
  );
  for (const target of targets) {
    const actualIntegrity = await collectTargetIntegrity(targetOutputDir(target));
    assert(
      JSON.stringify(actualIntegrity) === JSON.stringify(releaseManifest.integrity[target]),
      `${target}: artifacts changed after release verification`
    );
  }
}

console.log(`Verified ${targets.join(" and ")} artifacts in ${releaseOutputRoot}`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readReleaseManifest() {
  try {
    return JSON.parse(await readFile(releaseManifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
