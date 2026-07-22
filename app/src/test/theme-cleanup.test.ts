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

  it("keeps one color panel definition and one light editor workspace theme", () => {
    const css = fs.readFileSync(path.resolve(sourceRoot, "styles.css"), "utf8");
    expect(css.match(/^\.color-panel \{/gm) || []).toHaveLength(1);
    expect(css).toContain(".workspace-main .editor-shell {");
    expect(css).toContain(".workspace-main .editor-toolbar,");
    expect(css).toContain(".workspace-main .color-panel,");
    expect(css).toContain("background: #fff;");
  });

  it("ships one scoped light administration theme with responsive content rows", () => {
    const globalCss = fs.readFileSync(path.resolve(sourceRoot, "styles.css"), "utf8");
    const adminCss = fs.readFileSync(path.resolve(sourceRoot, "styles/admin.css"), "utf8");
    expect(globalCss.match(/^\.admin-shell \{/gm) || []).toHaveLength(1);
    expect(adminCss).toContain("--admin-sidebar: #191a1e;");
    expect(adminCss).toContain("--admin-canvas: #f5f5f2;");
    expect(adminCss).toContain("--admin-accent: #b34242;");
    expect(adminCss).toContain(".content-admin-table .content-table-row {");
    expect(adminCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("shows complete carousel artwork in a stable widescreen frame", () => {
    const css = fs.readFileSync(path.resolve(sourceRoot, "styles.css"), "utf8");
    expect(css).toMatch(/\.hero-carousel-frame \{[^}]*aspect-ratio: 16 \/ 9;/);
    expect(css).toMatch(/\.hero-carousel-image \{[^}]*object-fit: contain;/);
    expect(css).toMatch(/\.carousel-upload-box img \{[^}]*object-fit: contain;/);
    expect(css).toMatch(/\.carousel-slide-preview img \{[^}]*object-fit: contain;/);
    expect(css).toMatch(/\.mini-carousel-frame > img,[^}]*object-fit: contain;/);
  });
});
