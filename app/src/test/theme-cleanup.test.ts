import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(process.cwd(), "app/src");

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "test") return [];
    return entry.isDirectory() ? sourceFiles(target) : /\.(ts|tsx|css)$/.test(entry.name) ? [target] : [];
  });
}

describe("bundled theme cleanup", () => {
  it("does not ship the official asset library or external stock covers", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "app/public/official"))).toBe(false);
    const source = sourceFiles(sourceRoot).map((file) => fs.readFileSync(file, "utf8")).join("\n");
    expect(source).not.toContain("officialAssets");
    expect(source).not.toContain("images.unsplash.com");
    expect(source).not.toContain("heroBackgroundUrl");
  });
});
