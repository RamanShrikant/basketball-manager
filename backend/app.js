import express from "express";
import {onlineSeasonRolloverRequest} from "./onlineSeasonRollover.js";
import {onlineOptionsRequest} from "./onlineOptions.js";
import {onlineRightsRequest} from "./onlineRights.js";
import {onlineFreeAgencyRequest} from "./onlineFreeAgency.js";
import {onlineProgressionRequest} from "./onlineProgression.js";
import cors from "cors";
import { cpuTradeRequest, cpuTradeFinderRequest } from "./onlineCpuTrades.js";
import { initializeOnlineCalendarRequest } from "./onlineCalendar.js";
import { simulateOnlineDayRequest } from "./onlineSimulation.js";
import { closeOnlineTradeDeadlineRequest } from "./onlineTradeDeadline.js";
import { selectOnlineAllStarsRequest } from "./onlineAllStars.js";
import { onlineExtensionsRequest } from "./onlineExtensions.js";
import {initializeOnlinePostseasonRequest,simulateNextOnlinePlayInRequest,simulateNextOnlinePlayoffRequest} from "./onlinePostseason.js";

import {drawOnlineDraftLotteryRequest} from "./onlineDraftLottery.js";
import {onlineDraftAction} from "./onlineDraftActions.js";
import {onlineRookieSigningsRequest} from "./onlineRookieSignings.js";
import {onlineRetirementRequest} from "./onlineRetirements.js";

const app = express();
app.use(cors());
app.use(express.json());

// Online CPU trades run only on the trusted backend, never in the browser.
app.post("/api/online/cpu-trade", express.json({ limit: "16kb" }), cpuTradeRequest);
app.post("/api/online/cpu-trade-finder", express.json({ limit: "16kb" }), cpuTradeFinderRequest);

app.post("/api/online/calendar/initialize", express.json({ limit: "8kb" }), initializeOnlineCalendarRequest);
app.post("/api/online/calendar/simulate-next-day", express.json({ limit: "8kb" }), simulateOnlineDayRequest);
app.post("/api/online/calendar/close-trade-deadline", express.json({ limit: "8kb" }), closeOnlineTradeDeadlineRequest);
app.post("/api/online/calendar/select-all-stars", express.json({ limit: "8kb" }), selectOnlineAllStarsRequest);

// Original single-player contract engine, server-authorized GM offers and host deadline.
app.post("/api/online/extensions/preview", (req,res)=>onlineExtensionsRequest(req,res,'preview'));
app.post("/api/online/extensions/offer", (req,res)=>onlineExtensionsRequest(req,res,'offer'));
app.post("/api/online/extensions/close-veteran", (req,res)=>onlineExtensionsRequest(req,res,'close'));

// Host-only, revisioned Play-In initialization and trusted original-Python game simulation.
app.post("/api/online/postseason/initialize",express.json({limit:"8kb"}),initializeOnlinePostseasonRequest);
app.post("/api/online/postseason/simulate-playin",express.json({limit:"8kb"}),simulateNextOnlinePlayInRequest);
app.post("/api/online/postseason/simulate-playoff",express.json({limit:"8kb"}),simulateNextOnlinePlayoffRequest);

app.post("/api/online/draft/draw-lottery", express.json({limit:"8kb"}), drawOnlineDraftLotteryRequest);

// Trusted shared draft: ownership settlement, original Python class and GM/CPU picks.
app.post("/api/online/draft/settle-rights",express.json({limit:"8kb"}),(req,res)=>onlineDraftAction(req,res,'settle'));
app.post("/api/online/draft/start",express.json({limit:"8kb"}),(req,res)=>onlineDraftAction(req,res,'start'));
app.post("/api/online/draft/pick",express.json({limit:"8kb"}),(req,res)=>onlineDraftAction(req,res,'pick'));
app.post("/api/online/draft/auto-pick",express.json({limit:"8kb"}),(req,res)=>onlineDraftAction(req,res,'auto-pick'));

// Original single-player rookie contract engine, GM ownership and host-only CPU processing.
app.post("/api/online/rookies/preview",express.json({limit:"8kb"}),(req,res)=>onlineRookieSigningsRequest(req,res,'preview'));
app.post("/api/online/rookies/sign",express.json({limit:"12kb"}),(req,res)=>onlineRookieSigningsRequest(req,res,'sign'));
app.post("/api/online/rookies/resolve-cpu",express.json({limit:"8kb"}),(req,res)=>onlineRookieSigningsRequest(req,res,'cpu'));

// Offseason retirements: original Python engine, preview for members, host-only commit.
app.post("/api/online/offseason/retirements/preview",express.json({limit:"8kb"}),(req,res)=>onlineRetirementRequest(req,res,'preview'));
app.post("/api/online/offseason/retirements/run",express.json({limit:"8kb"}),(req,res)=>onlineRetirementRequest(req,res,'run'));

// Online offseason: human GM options, then original-engine CPU/player finalization.
app.post("/api/online/offseason/options/preview",express.json({limit:"8kb"}),(req,res)=>onlineOptionsRequest(req,res,"preview"));
app.post("/api/online/offseason/options/submit",express.json({limit:"16kb"}),(req,res)=>onlineOptionsRequest(req,res,"submit"));
app.post("/api/online/offseason/options/finalize",express.json({limit:"8kb"}),(req,res)=>onlineOptionsRequest(req,res,"finalize"));

// Original single-player Bird rights and qualifying-offer engine; rights resolved before free agency.
app.post("/api/online/offseason/rights/preview",express.json({limit:"8kb"}),(req,res)=>onlineRightsRequest(req,res,"preview"));
app.post("/api/online/offseason/rights/submit",express.json({limit:"16kb"}),(req,res)=>onlineRightsRequest(req,res,"submit"));
app.post("/api/online/offseason/rights/finalize",express.json({limit:"8kb"}),(req,res)=>onlineRightsRequest(req,res,"finalize"));

// Original single-player market valuation & CPU bid generation, authoritative GM offer submission.
app.post("/api/online/offseason/free-agency/open",express.json({limit:"8kb"}),(req,res)=>onlineFreeAgencyRequest(req,res,"open"));
app.post("/api/online/offseason/free-agency/offer",express.json({limit:"8kb"}),(req,res)=>onlineFreeAgencyRequest(req,res,"offer"));
app.post("/api/online/offseason/free-agency/resolve",express.json({limit:"8kb"}),(req,res)=>onlineFreeAgencyRequest(req,res,"resolve"));
app.post("/api/online/offseason/free-agency/decision",express.json({limit:"8kb"}),(req,res)=>onlineFreeAgencyRequest(req,res,"decision"));
app.post("/api/online/offseason/free-agency/next",express.json({limit:"8kb"}),(req,res)=>onlineFreeAgencyRequest(req,res,"next"));

// One-time trusted new-season transition; never from a browser-computed state.
app.post("/api/online/offseason/start-next-season",express.json({limit:"8kb"}),onlineSeasonRolloverRequest);

// ✅ Simple health check route (optional)
app.get("/", (_req, res) => {
  res.json({ status: "Basketball Manager backend running" });
});

// 2E.4-D: the host commits one shared player progression after free agency.
app.post("/api/online/offseason/progression/run",express.json({limit:"8kb"}),onlineProgressionRequest);

export default app;
