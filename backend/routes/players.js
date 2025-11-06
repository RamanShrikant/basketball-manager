import express from "express";
import {
  createPlayer,
  ensurePlayerExists,
  ensureTeamExists,
  listPlayers,
  updatePlayer,
} from "../data/store.js";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({ players: listPlayers() });
});

router.post("/", (req, res) => {
  try {
    if (req.body.teamId) {
      ensureTeamExists(req.body.teamId);
    }
    const player = createPlayer(req.body ?? {});
    res.status(201).json({ player });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put("/:playerId", (req, res) => {
  try {
    const payload = req.body ?? {};
    if (Object.prototype.hasOwnProperty.call(payload, "teamId") && payload.teamId) {
      ensureTeamExists(payload.teamId);
    }
    ensurePlayerExists(req.params.playerId);
    const player = updatePlayer(req.params.playerId, payload);
    res.json({ player });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
