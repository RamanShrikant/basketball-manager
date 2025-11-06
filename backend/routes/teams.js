import express from "express";
import { findTeam, listTeams } from "../data/store.js";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ teams: listTeams() });
});

router.get("/:teamId", (req, res) => {
  const team = findTeam(req.params.teamId);
  if (!team) {
    return res.status(404).json({ error: "Team not found" });
  }
  res.json({ team });
});

export default router;
