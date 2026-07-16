// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  define: {
    __DEV_SERVER_BOOT_ID__: JSON.stringify(Date.now()),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
  // Trade Finder worker imports app modules, so production builds need ES module workers.
  // Rollup/Vite's default iife worker format cannot code-split that worker graph.
  worker: {
    format: "es",
  },
});
