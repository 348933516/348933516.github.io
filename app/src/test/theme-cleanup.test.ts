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
    expect(adminCss).toMatch(/\.admin-shell \{[^}]*display: grid;[^}]*grid-template-columns:/);
    expect(adminCss).toContain(".content-admin-table .content-table-row {");
    expect(adminCss).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps media controls inside narrow cards and exposes a compact cover picker", () => {
    const adminCss = fs.readFileSync(path.resolve(sourceRoot, "styles/admin.css"), "utf8");
    expect(adminCss).toContain(".content-cover-control { min-width: 0;");
    expect(adminCss).toContain(".media-video-list { min-width: 0;");
    expect(adminCss).toContain("container-type: inline-size;");
    expect(adminCss).toContain("@container (max-width: 760px)");
    expect(adminCss).toContain(".media-card-action-primary, .media-card-action-utility { display: flex;");
    expect(adminCss).toContain("flex-wrap: wrap;");
  });

  it("shows complete carousel artwork in a stable widescreen frame", () => {
    const css = fs.readFileSync(path.resolve(sourceRoot, "styles.css"), "utf8");
    expect(css).toMatch(/\.hero-carousel-frame \{[^}]*aspect-ratio: 16 \/ 9;/);
    expect(css).toMatch(/\.hero-carousel-image \{[^}]*object-fit: contain;/);
    expect(css).toMatch(/\.carousel-upload-box img \{[^}]*object-fit: contain;/);
    expect(css).toMatch(/\.carousel-slide-preview img \{[^}]*object-fit: contain;/);
    expect(css).toMatch(/\.mini-carousel-frame > img,[^}]*object-fit: contain;/);
  });

  it("collapses the public document outline grid to one column on phones", () => {
    const css = fs.readFileSync(path.resolve(sourceRoot, "styles.css"), "utf8");
    const mobileOverride = css.lastIndexOf(".reader-layout.with-outline,\n  .reader-layout.without-outline {");
    const desktopColumns = css.indexOf(".reader-layout.with-outline { grid-template-columns: 220px minmax(0,1fr); }");

    expect(mobileOverride).toBeGreaterThan(desktopColumns);
    expect(css.slice(mobileOverride, mobileOverride + 180)).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(css).toContain(".reader-layout,\n  .reader-main,\n  .reader-body {");
  });
});
