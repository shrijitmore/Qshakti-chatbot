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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const chunk_1 = require("../utils/chunk");
const embeddings_1 = require("../services/embeddings");
const inMemoryVectorStore_1 = require("../services/inMemoryVectorStore");
const adaptiveVectorStore_1 = require("../services/adaptiveVectorStore");
const jsonToText_1 = require("../utils/jsonToText");
exports.ingestRouter = (0, express_1.Router)();
const IngestSchema = zod_1.z.object({
    namespace: zod_1.z.string().optional(),
    chunkSize: zod_1.z.number().int().min(50).max(4000).optional().default(800),
    chunkOverlap: zod_1.z.number().int().min(0).max(400).optional().default(100),
    documents: zod_1.z
        .array(zod_1.z
        .object({
        id: zod_1.z.string().optional(),
        text: zod_1.z.string().min(1).optional(),
        json: zod_1.z.unknown().optional(),
        metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
    })
        .refine((d) => typeof d.text === "string" || d.json !== undefined, {
        message: "Each document must include either 'text' or 'json'",
        path: ["text"],
    }))
        .min(1),
});
// Enhanced text extraction specifically for QC inspection data
function enhancedQCTextExtraction(record) {
    const sections = [];
    // Basic record info
    sections.push(`INSPECTION RECORD ID: ${record.id}`);
    sections.push(`Created: ${record.created_at}`);
    sections.push(`Active Status: ${record.is_active ? 'Active' : 'Inactive'}`);
    sections.push(`Purchase Order: ${record.po_no}`);
    // Actual readings - critical data
    if (record.actual_readings) {
        if (Array.isArray(record.actual_readings)) {
            const readings = record.actual_readings;
            if (readings.length > 0 && typeof readings[0] === 'object') {
                // Object format with accepted/rejected
                sections.push(`INSPECTION RESULTS:`);
                readings.forEach((reading, idx) => {
                    sections.push(`Reading ${idx + 1}: Accepted=${reading.accepted || 0}, Rejected=${reading.rejected || 0}`);
                });
            }
            else {
                // Numeric array
                sections.push(`MEASUREMENTS: ${readings.join(', ')}`);
            }
        }
    }
    // Inspector info
    if (record.created_by_id) {
        const inspector = record.created_by_id;
        sections.push(`INSPECTOR: ${inspector.first_name} ${inspector.last_name} (${inspector.email})`);
        if (inspector.plant_id) {
            sections.push(`PLANT: ${inspector.plant_id.plant_name} (ID: ${inspector.plant_id.plant_id})`);
            if (inspector.plant_id.plant_location_1) {
                sections.push(`Location: ${inspector.plant_id.plant_location_1}`);
            }
        }
        if (inspector.role_id) {
            sections.push(`Role: ${inspector.role_id.name} - ${inspector.role_id.description}`);
        }
    }
    // Inspection schedule details
    if (record.insp_schedule_id_id) {
        const schedule = record.insp_schedule_id_id;
        sections.push(`INSPECTION SPECIFICATIONS:`);
        sections.push(`Target Value: ${schedule.target_value}, LSL: ${schedule.LSL}, USL: ${schedule.USL}`);
        sections.push(`Sample Size: ${schedule.sample_size}, Frequency: ${schedule.inspection_frequency}`);
        sections.push(`Method: ${schedule.inspection_method}, Recording: ${schedule.recording_type}`);
        sections.push(`Defect Classification: ${schedule.likely_defects_classification}`);
        if (schedule.remarks) {
            sections.push(`Remarks: ${schedule.remarks}`);
        }
        // Item details
        if (schedule.item_code_id) {
            const item = schedule.item_code_id;
            sections.push(`ITEM: ${item.item_code} - ${item.item_description}`);
            sections.push(`Type: ${item.item_type}, Unit: ${item.unit}`);
            if (item.end_store)
                sections.push(`End Store: ${item.end_store}`);
        }
        // Building info
        if (schedule.building_id) {
            const building = schedule.building_id;
            sections.push(`BUILDING: ${building.building_name} (${building.building_id})`);
            sections.push(`Sub-section: ${building.sub_section}`);
        }
        // QC Machine
        if (schedule.qc_machine_id_id) {
            const machine = schedule.qc_machine_id_id;
            sections.push(`QC MACHINE: ${machine.machine_name} (${machine.machine_id})`);
            sections.push(`Make/Model: ${machine.machine_make} ${machine.machine_model}`);
            sections.push(`Type: ${machine.machine_type}, Digital: ${machine.is_digital ? 'Yes' : 'No'}`);
        }
        // Operation
        if (schedule.operation_id) {
            const operation = schedule.operation_id;
            sections.push(`OPERATION: ${operation.operation_name} (${operation.operation_id})`);
            sections.push(`Description: ${operation.operation_description}`);
        }
        // Inspection Parameter
        if (schedule.inspection_parameter_id) {
            const param = schedule.inspection_parameter_id;
            sections.push(`PARAMETER: ${param.inspection_parameter} (${param.inspection_parameter_id})`);
            sections.push(`Parameter Description: ${param.parameter_description}`);
        }
    }
    return sections.filter(s => s && s.trim()).join('\n');
}
// Standard ingest endpoint
exports.ingestRouter.post("/", async (req, res) => {
    try {
        const { namespace, documents, chunkSize, chunkOverlap } = IngestSchema.parse(req.body);
        const allChunks = [];
        for (const doc of documents) {
            const baseText = typeof doc.text === "string" && doc.text.length > 0 ? doc.text : (0, jsonToText_1.jsonToText)(doc.json);
            if (!baseText || baseText.trim().length === 0)
                continue;
            const chunks = (0, chunk_1.chunkText)(baseText, chunkSize, chunkOverlap);
            for (const c of chunks) {
                allChunks.push({
                    id: `${doc.id ?? "doc"}-${Math.random().toString(36).slice(2)}`,
                    text: c,
                    metadata: { ...(doc.metadata ?? {}), sourceId: doc.id ?? null },
                });
            }
        }
        // Embed and upsert
        const texts = allChunks.map((d) => d.text);
        const vectors = await embeddings_1.embeddings.embedMany(texts);
        await inMemoryVectorStore_1.vectorStore.upsert(allChunks.map((d, i) => ({
            id: d.id,
            text: d.text,
            metadata: d.metadata ?? {},
            embedding: vectors[i],
            namespace: namespace ?? "default",
        })));
        const stats = await adaptiveVectorStore_1.adaptiveVectorStore.getStats(namespace ?? "default");
        const storageType = adaptiveVectorStore_1.adaptiveVectorStore.getActiveStorageType();
        res.json({
            ok: true,
            chunksAdded: allChunks.length,
            namespace: namespace ?? "default",
            storageType,
            stats
        });
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ ok: false, error: err.message ?? "Ingest failed" });
    }
});
// Endpoint to load QC data from the provided URL
exports.ingestRouter.post("/load-qc", async (req, res) => {
    try {
        const QC_DATA_URL = 'https://customer-assets.emergentagent.com/job_f5e7d433-dcc8-4bb7-8a11-aa712eeef810/artifacts/882htwtq_schema.json';
        console.log('📥 Fetching QC data from URL...');
        // Import fetch dynamically for Node.js compatibility
        const fetch = (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
        const response = await fetch(QC_DATA_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch QC data: ${response.status} ${response.statusText}`);
        }
        const qcData = await response.json();
        console.log(`✅ Fetched ${Array.isArray(qcData) ? qcData.length : 'unknown'} records`);
        if (!Array.isArray(qcData)) {
            throw new Error('QC data is not in expected array format');
        }
        // Process using the existing QC data processing logic
        const namespace = "qc_inspections";
        const chunkSize = 1200;
        const chunkOverlap = 200;
        const allChunks = [];
        let processedCount = 0;
        for (const record of qcData) {
            // Enhanced text extraction for QC data
            const recordText = enhancedQCTextExtraction(record);
            if (!recordText || recordText.trim().length < 50) {
                console.log(`Skipping record ${record.id} - insufficient data`);
                continue;
            }
            const chunks = (0, chunk_1.chunkText)(recordText, chunkSize, chunkOverlap);
            for (let i = 0; i < chunks.length; i++) {
                allChunks.push({
                    id: `qc-${record.id || processedCount}-chunk-${i}`,
                    text: chunks[i],
                    metadata: {
                        recordId: record.id,
                        plantId: record.created_by_id?.plant_id?.plant_id,
                        plantName: record.created_by_id?.plant_id?.plant_name,
                        itemCode: record.insp_schedule_id_id?.item_code_id?.item_code,
                        itemDescription: record.insp_schedule_id_id?.item_code_id?.item_description,
                        operationName: record.insp_schedule_id_id?.operation_id?.operation_name,
                        inspectionParameter: record.insp_schedule_id_id?.inspection_parameter_id?.inspection_parameter,
                        machineName: record.insp_schedule_id_id?.qc_machine_id_id?.machine_name,
                        inspectionFrequency: record.insp_schedule_id_id?.inspection_frequency,
                        defectClassification: record.insp_schedule_id_id?.likely_defects_classification,
                        createdAt: record.created_at,
                        recordType: 'qc_inspection',
                        chunkIndex: i,
                        totalChunks: chunks.length
                    },
                });
            }
            processedCount++;
            // Progress logging
            if (processedCount % 500 === 0) {
                console.log(`Processed ${processedCount}/${qcData.length} records`);
            }
        }
        console.log(`Generated ${allChunks.length} chunks from ${processedCount} records`);
        // Batch embedding for better performance
        const batchSize = 25; // Smaller batches for better reliability
        let totalEmbedded = 0;
        for (let i = 0; i < allChunks.length; i += batchSize) {
            const batch = allChunks.slice(i, i + batchSize);
            const texts = batch.map((d) => d.text);
            console.log(`Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}`);
            const vectors = await embeddings_1.embeddings.embedMany(texts);
            await inMemoryVectorStore_1.vectorStore.upsert(batch.map((d, idx) => ({
                id: d.id,
                text: d.text,
                metadata: d.metadata ?? {},
                embedding: vectors[idx],
                namespace,
            })));
            totalEmbedded += batch.length;
            console.log(`Embedded and stored ${totalEmbedded}/${allChunks.length} chunks`);
        }
        const stats = await adaptiveVectorStore_1.adaptiveVectorStore.getStats(namespace);
        const storageType = adaptiveVectorStore_1.adaptiveVectorStore.getActiveStorageType();
        res.json({
            ok: true,
            message: `Successfully processed ${processedCount} QC records into ${allChunks.length} chunks`,
            recordsProcessed: processedCount,
            chunksCreated: allChunks.length,
            namespace,
            storageType,
            stats
        });
    }
    catch (err) {
        console.error("QC data loading error:", err);
        res.status(400).json({ ok: false, error: err.message ?? "QC data loading failed" });
    }
});
