// server.js
import overallRoute from "./routes/overall.js";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/overall", overallRoute);


app.get("/", (req, res) => {
  res.send("Basketball Manager backend running!");
});

app.listen(5000, () => console.log("✅ Server started on port 5000"));
