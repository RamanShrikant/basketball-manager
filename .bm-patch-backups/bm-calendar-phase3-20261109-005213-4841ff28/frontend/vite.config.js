// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

function portraitFitsWriterPlugin() {
  return {
    name: "bm-portrait-fits-writer",
    configureServer(server) {
      server.middlewares.use("/__bm/portrait-fits", (req, res, next) => {
        if (req.method !== "POST") return next();
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > 5_000_000) req.destroy();
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(raw || "{}");
            if (parsed?.version !== "bm_portrait_dressing_fit_v2" || !parsed?.fitByFace || typeof parsed.fitByFace !== "object") {
              throw new Error("Expected a bm_portrait_dressing_fit_v2 payload with fitByFace.");
            }
            const target = path.resolve(__dirname, "public/assets/portrait_studio/fits/portrait_fits.json");
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, target: "public/assets/portrait_studio/fits/portrait_fits.json" }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), portraitFitsWriterPlugin()],
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
