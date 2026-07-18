import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "app",
  base: process.env.VITE_BASE_PATH || "/preview/",
  plugins: [react()],
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
