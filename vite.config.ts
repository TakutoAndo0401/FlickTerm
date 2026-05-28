import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, "out/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/renderer/index.html")
    }
  }
});
