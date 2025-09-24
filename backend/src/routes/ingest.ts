import { Router } from "express";
import { z } from "zod";
import { chunkText } from "../utils/chunk";
import { embeddings } from "../services/embeddings";
import { vectorStore } from "../services/inMemoryVectorStore";
import type { IngestDocument } from "../types";
import { jsonToText } from "../utils/jsonToText";

export const ingestRouter = Router();

const IngestSchema = z.object({
  namespace: z.string().optional(),
  chunkSize: z.number().int().min(50).max(4000).optional().default(800),
  chunkOverlap: z.number().int().min(0).max(400).optional().default(100),
  documents: z
    .array(
      z
        .object({
          id: z.string().optional(),
          text: z.string().min(1).optional(),
          json: z.unknown().optional(),
          metadata: z.record(z.string(), z.any()).optional(),
        })
        .refine((d) => typeof d.text === "string" || d.json !== undefined, {
          message: "Each document must include either 'text' or 'json'",
          path: ["text"],
        })
    )
    .min(1),
});

// Enhanced text extraction specifically for QC inspection data
function enhancedQCTextExtraction(record: any): string {
  const sections: string[] = [];
  
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
        readings.forEach((reading: any, idx: number) => {
          sections.push(`Reading ${idx + 1}: Accepted=${reading.accepted || 0}, Rejected=${reading.rejected || 0}`);
        });
      } else {
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
      if (item.end_store) sections.push(`End Store: ${item.end_store}`);
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
ingestRouter.post("/", async (req, res) => {
  try {
    const { namespace, documents, chunkSize, chunkOverlap } = IngestSchema.parse(req.body);

    const allChunks: IngestDocument[] = [];
    for (const doc of documents) {
      const baseText = typeof doc.text === "string" && doc.text.length > 0 ? doc.text : jsonToText(doc.json);
      if (!baseText || baseText.trim().length === 0) continue;
      const chunks = chunkText(baseText, chunkSize, chunkOverlap);
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
    const vectors = await embeddings.embedMany(texts);

    await vectorStore.upsert(
      allChunks.map((d, i) => ({
        id: d.id,
        text: d.text,
        metadata: d.metadata ?? {},
        embedding: vectors[i],
        namespace: namespace ?? "default",
      }))
    );

    const stats = await adaptiveVectorStore.getStats(namespace ?? "default");
    const storageType = adaptiveVectorStore.getActiveStorageType();
    
    res.json({ 
      ok: true, 
      chunksAdded: allChunks.length, 
      namespace: namespace ?? "default",
      storageType,
      stats
    });
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ ok: false, error: err.message ?? "Ingest failed" });
  }
});

// Endpoint to load QC data from the provided URL
ingestRouter.post("/load-qc", async (req, res) => {
  try {
    const QC_DATA_URL = 'https://customer-assets.emergentagent.com/job_f5e7d433-dcc8-4bb7-8a11-aa712eeef810/artifacts/882htwtq_schema.json';
    
    console.log('📥 Fetching QC data from URL...');
    
    // Import fetch dynamically for Node.js compatibility
    const fetch = (await import('node-fetch')).default;
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
    
    const allChunks: IngestDocument[] = [];
    let processedCount = 0;
    
    for (const record of qcData) {
      // Enhanced text extraction for QC data
      const recordText = enhancedQCTextExtraction(record);
      
      if (!recordText || recordText.trim().length < 50) {
        console.log(`Skipping record ${record.id} - insufficient data`);
        continue;
      }
      
      const chunks = chunkText(recordText, chunkSize, chunkOverlap);
      
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
      
      console.log(`Embedding batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allChunks.length/batchSize)}`);
      const vectors = await embeddings.embedMany(texts);

      await vectorStore.upsert(
        batch.map((d, idx) => ({
          id: d.id,
          text: d.text,
          metadata: d.metadata ?? {},
          embedding: vectors[idx],
          namespace,
        }))
      );
      
      totalEmbedded += batch.length;
      console.log(`Embedded and stored ${totalEmbedded}/${allChunks.length} chunks`);
    }

    const stats = await adaptiveVectorStore.getStats(namespace);
    const storageType = adaptiveVectorStore.getActiveStorageType();

    res.json({ 
      ok: true, 
      message: `Successfully processed ${processedCount} QC records into ${allChunks.length} chunks`,
      recordsProcessed: processedCount,
      chunksCreated: allChunks.length,
      namespace,
      storageType,
      stats
    });
    
  } catch (err: any) {
    console.error("QC data loading error:", err);
    res.status(400).json({ ok: false, error: err.message ?? "QC data loading failed" });
  }
});