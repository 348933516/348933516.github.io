import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_BASE_PATH || "/preview/";
const outputDir = process.env.VITE_OUTPUT_DIR || "../preview";
const formalBuild = process.env.VITE_FORMAL_BUILD === "1";

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
    emptyOutDir: !formalBuild,
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
});
