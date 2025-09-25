"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadQCData = loadQCData;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const QC_DATA_PATH = path_1.default.resolve(__dirname, '../../JSON data/schema.json');
const BACKEND_URL = `http://localhost:${process.env.PORT || 3001}`;
async function loadQCData() {
    console.log('Starting QC data loading process...');
    try {
        // Read the local QC data file
        console.log(`Reading QC data from local file: ${QC_DATA_PATH}`);
        if (!fs_1.default.existsSync(QC_DATA_PATH)) {
            throw new Error(`Data file not found at: ${QC_DATA_PATH}`);
        }
        const fileContent = fs_1.default.readFileSync(QC_DATA_PATH, 'utf-8');
        const qcData = JSON.parse(fileContent);
        console.log(`Fetched ${Array.isArray(qcData) ? qcData.length : 'unknown'} records`);
        // Send to ingestion endpoint
        console.log('Sending data to ingestion endpoint...');
        const ingestResponse = await (0, node_fetch_1.default)(`${BACKEND_URL}/ingest/qc-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                namespace: 'qc_inspections',
                data: qcData,
                chunkSize: 5000,
                chunkOverlap: 1000
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
