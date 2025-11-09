import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Simple health check route (optional)
app.get("/", (_req, res) => {
  res.json({ status: "Basketball Manager backend running" });
});

export default app;
