import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const releaseTarget = process.env.VITE_RELEASE_TARGET === "formal" ? "formal" : "preview";
const base = releaseTarget === "formal" ? "/" : "/preview/";
const outputDir = process.env.VITE_OUTPUT_DIR || `../.release/${releaseTarget}`;

export default defineConfig({
  root: "app",
  base,
  plugins: [
    react(),
    {
      name: "production-indexing",
      transformIndexHtml(html) {
        return base === "/" ? html.replace(/\s*<meta name="robots" content="noindex,nofollow" \/>/, "") : html;
      }
    }
  ],
  worker: { format: "es" },
  build: {
    outDir: outputDir,
    assetsDir: "assets",
    emptyOutDir: true,
    manifest: true,
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
});
