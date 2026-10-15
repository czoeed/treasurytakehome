import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves this project from /treasurytakehome/, so relative
  // asset paths keep scripts, styles, and OCR models working there.
  base: "./",
});
