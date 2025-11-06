import express from "express";
import cors from "cors";
import overallRoute from "./routes/overall.js";
import teamsRoute from "./routes/teams.js";
import playersRoute from "./routes/players.js";
import tradeRoute from "./routes/trade.js";
import simulateRoute from "./routes/simulate.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/teams", teamsRoute);
app.use("/players", playersRoute);
app.use("/trade", tradeRoute);
app.use("/simulate", simulateRoute);
app.use("/overall", overallRoute);

app.use("/api/teams", teamsRoute);
app.use("/api/players", playersRoute);
app.use("/api/trade", tradeRoute);
app.use("/api/simulate", simulateRoute);
app.use("/api/overall", overallRoute);

app.get(["/", "/api"], (_req, res) => {
  res.json({ status: "Basketball Manager backend running" });
});

export default app;
