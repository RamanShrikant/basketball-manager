import express from "express";
import { simulateGame } from "../data/store.js";

const router = express.Router();

router.post("/", (req, res) => {
  try {
    const result = simulateGame(req.body ?? {});
    res.json({ result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
