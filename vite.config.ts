import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_BASE_PATH || "/preview/";

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
    outDir: "../preview",
    emptyOutDir: true,
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
});
