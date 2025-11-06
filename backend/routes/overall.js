import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// POST /overall → send player attributes + position
router.post("/", (req, res) => {
  const { attrs, pos } = req.body;

  // Use absolute path to avoid Windows path issues with spaces
  const pythonFile = path.join(__dirname, "../python/2kratings superstar boost.py");

  const py = spawn("python", [pythonFile]);

  let output = "";

  py.stdin.write(JSON.stringify({ attrs, pos }));
  py.stdin.end();

  py.stdout.on("data", (data) => {
    output += data.toString();
  });

  py.stderr.on("data", (data) => {
    console.error("🐍 Python error:", data.toString());
  });

  py.on("close", (code) => {
    console.log("🐍 Python exited with code:", code);
    try {
      const parsed = parseInt(output.trim(), 10);
      if (isNaN(parsed)) {
        return res.status(500).json({ error: "Invalid output", raw: output });
      }
      res.json({ overall: parsed });
    } catch (err) {
      res.status(500).json({ error: err.message, raw: output });
    }
  });
});

export default router;
