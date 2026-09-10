import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "../dist/supply",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
  },
});
