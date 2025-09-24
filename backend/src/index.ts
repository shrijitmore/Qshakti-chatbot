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
// Enhanced health check endpoint
app.get("/health", async (_req, res) => {
  try {
    const { adaptiveVectorStore } = await import('./services/adaptiveVectorStore');
    const stats = await adaptiveVectorStore.getStats('qc_inspections');
    const storageType = adaptiveVectorStore.getActiveStorageType();
    
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      storage: {
        type: storageType,
        qc_records_available: stats.count || 0
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hasGoogleKey: !!process.env.GOOGLE_API_KEY
      }
    });
  } catch (error) {
    res.status(500).json({ 
      status: "error", 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use("/ingest", ingestRouter);
app.use("/query", queryRouter);

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
