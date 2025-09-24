"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadQCData = loadQCData;
const node_fetch_1 = __importDefault(require("node-fetch"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const QC_DATA_URL = 'https://customer-assets.emergentagent.com/job_f5e7d433-dcc8-4bb7-8a11-aa712eeef810/artifacts/882htwtq_schema.json';
const BACKEND_URL = `http://localhost:${process.env.PORT || 3001}`;
async function loadQCData() {
    console.log('🔄 Starting QC data loading process...');
    try {
        // Fetch the QC data
        console.log('📥 Fetching QC data from URL...');
        const response = await (0, node_fetch_1.default)(QC_DATA_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
        }
        const qcData = await response.json();
        console.log(`✅ Fetched ${Array.isArray(qcData) ? qcData.length : 'unknown'} records`);
        // Send to ingestion endpoint
        console.log('🔄 Sending data to ingestion endpoint...');
        const ingestResponse = await (0, node_fetch_1.default)(`${BACKEND_URL}/ingest/qc-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                namespace: 'qc_inspections',
                data: qcData,
                chunkSize: 1200,
                chunkOverlap: 200
            }),
        });
        if (!ingestResponse.ok) {
            const errorText = await ingestResponse.text();
            throw new Error(`Ingestion failed: ${ingestResponse.status} ${errorText}`);
        }
        const result = await ingestResponse.json();
        console.log('✅ QC Data ingestion completed successfully!');
        console.log('📊 Results:', {
            recordsProcessed: result.recordsProcessed,
            chunksCreated: result.chunksCreated,
            storageType: result.storageType,
            stats: result.stats
        });
    }
    catch (error) {
        console.error('❌ QC data loading failed:', error.message);
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    loadQCData();
}
