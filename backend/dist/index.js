"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ingest_1 = require("./routes/ingest");
const query_1 = require("./routes/query");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "10mb" }));
// Serve static frontend (public/index.html)
app.use(express_1.default.static("public"));
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
// Enhanced health check endpoint
app.get("/health", async (_req, res) => {
    try {
        const { adaptiveVectorStore } = await Promise.resolve().then(() => __importStar(require('./services/adaptiveVectorStore')));
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
    }
    catch (error) {
        res.status(500).json({
            status: "error",
            error: error?.message || 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});
app.use("/ingest", ingest_1.ingestRouter);
app.use("/query", query_1.queryRouter);
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
