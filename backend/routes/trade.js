import express from "express";
import { evaluateTrade } from "../data/store.js";

const router = express.Router();

router.post("/", (req, res) => {
  try {
    const trade = evaluateTrade(req.body ?? {});
    res.json({ trade });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
