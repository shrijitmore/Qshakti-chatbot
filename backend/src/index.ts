import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { ingestRouter } from "./routes/ingest";
import { queryRouter } from "./routes/query";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
// Serve static frontend (public/index.html)
app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/ingest", ingestRouter);
app.use("/query", queryRouter);

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
