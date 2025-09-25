import { Router } from "express";
import fs from 'fs';
import path from 'path';
import { z } from "zod";
import { chunkText } from "../utils/chunk";
import { embeddings } from "../services/embeddings";
import { vectorStore } from "../services/inMemoryVectorStore";
import type { IngestDocument } from "../types";
import { schemaMapper } from "../utils/schemaMapper";
import { enhancedJsonToText } from "../utils/enhancedJsonToText";

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

// New, schema-aware text extraction for QC inspection data
function enhancedQCTextExtraction(record: any): string {
  const sections: string[] = [];
  const add = (key: string, value: any) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      sections.push(`${key}: ${value}`);
    }
  };

  sections.push(`--- INSPECTION RECORD (ID: ${record.id}) ---`);
  add('PO Number', record.po_no);
  add('Status', record.is_active ? 'Active' : 'Inactive');
  add('Created At', record.created_at);

  if (Array.isArray(record.actual_readings) && record.actual_readings.length > 0) {
    sections.push('\n--- READINGS ---');
    const r = record.actual_readings[0];
    if (typeof r === 'object' && r !== null) {
      add('Accepted', r.accepted);
      add('Rejected', r.rejected);
    } else {
      add('Measurements', record.actual_readings.join(', '));
    }
  }

  if (record.created_by_id) {
    const inspector = record.created_by_id;
    sections.push('\n--- INSPECTOR & PLANT ---');
    add('Inspector Name', `${inspector.first_name} ${inspector.last_name}`);
    add('Inspector Email', inspector.email);
    if (inspector.plant_id) {
      add('Plant ID', inspector.plant_id.plant_id);
      add('Plant Name', inspector.plant_id.plant_name);
    }
    if (inspector.role_id) {
      add('Inspector Role', inspector.role_id.name);
    }
  }

  if (record.insp_schedule_id_id) {
    const schedule = record.insp_schedule_id_id;
    sections.push(`\n--- SCHEDULE & SPECIFICATIONS (ID: ${schedule.id}) ---`);
    add('LSL', schedule.LSL);
    add('Target', schedule.target_value);
    add('USL', schedule.USL);
    add('Sample Size', schedule.sample_size);
    add('Frequency', schedule.inspection_frequency);
    add('Method', schedule.inspection_method);
    add('Defect Class', schedule.likely_defects_classification);

    if (schedule.item_code_id) {
      const item = schedule.item_code_id;
      sections.push('\n--- ITEM ---');
      add('Item Code', item.item_code);
      add('Item Description', item.item_description);
      add('Item Type', item.item_type);
      add('Unit', item.unit);
    }

    if (schedule.operation_id) {
      const op = schedule.operation_id;
      sections.push('\n--- OPERATION ---');
      add('Operation ID', op.operation_id);
      add('Operation Name', op.operation_name);
    }

    if (schedule.qc_machine_id_id) {
      const machine = schedule.qc_machine_id_id;
      sections.push('\n--- QC MACHINE ---');
      add('Machine ID', machine.machine_id);
      add('Machine Name', machine.machine_name);
      add('Make/Model', `${machine.machine_make} ${machine.machine_model}`);
    }

    if (schedule.inspection_parameter_id) {
      const param = schedule.inspection_parameter_id;
      sections.push('\n--- PARAMETER ---');
      add('Parameter ID', param.inspection_parameter_id);
      add('Parameter', param.inspection_parameter);
    }
  }

  return sections.join('\n');
}

// Standard ingest endpoint
ingestRouter.post("/", async (req, res) => {
  try {
    const { namespace, documents, chunkSize, chunkOverlap } = IngestSchema.parse(req.body);

    const allChunks: IngestDocument[] = [];
    for (const doc of documents) {
      // Use enhanced extractor if doc.json exists, otherwise use doc.text
      const baseText = doc.json 
        ? enhancedQCTextExtraction(doc.json) 
        : (typeof doc.text === "string" ? doc.text : "");
      
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

    res.json({ 
      ok: true, 
      chunksAdded: allChunks.length, 
      namespace: namespace ?? "default",
      storageType: "In-Memory"
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
    const chunkSize = 1200; // Increased for richer context
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
    const batchSize = 20;
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

    res.json({ 
      ok: true, 
      message: `Successfully processed ${processedCount} QC records into ${allChunks.length} chunks`,
      recordsProcessed: processedCount,
      chunksCreated: allChunks.length,
      namespace,
      storageType: "In-Memory"
    });
    
  } catch (err: any) {
    console.error("QC data loading error:", err);
    res.status(400).json({ ok: false, error: err.message ?? "QC data loading failed" });
  }
});

// Endpoint for the frontend button to trigger ingestion from local file
ingestRouter.post("/trigger-load", async (req, res) => {
  try {
    console.log('🔄 Triggering local QC data loading process...');
    
    const QC_DATA_PATH = path.resolve(__dirname, '../../JSON data/schema.json');

    if (!fs.existsSync(QC_DATA_PATH)) {
      throw new Error(`Data file not found at: ${QC_DATA_PATH}`);
    }
    const fileContent = fs.readFileSync(QC_DATA_PATH, 'utf-8');
    const qcData = JSON.parse(fileContent);
    
    // Clear old data first
    const storagePath = path.resolve(__dirname, '../../.vector_storage');
    const namespaceFile = path.join(storagePath, 'qc_inspections.json');
    if (fs.existsSync(namespaceFile)) {
      console.log(`🗑️  Deleting old data file: ${namespaceFile}...`);
      fs.unlinkSync(namespaceFile);
      console.log(`✅ Old data file deleted successfully.`);
    }
    
    // Process the data using raw JSON (not flattened text)
    const namespace = "qc_inspections";
    const allChunks: IngestDocument[] = [];
    let processedCount = 0;
    
    // Process each table in the schema.json structure
    for (const tableName in qcData) {
      const tableData = qcData[tableName];
      if (tableData && tableData.sample_rows && Array.isArray(tableData.sample_rows)) {
        console.log(`Processing table: ${tableName} with ${tableData.sample_rows.length} records`);
        
        for (const record of tableData.sample_rows) {
          if (!record.id) continue;
          
          // Store raw JSON instead of flattened text - this preserves data structure
          allChunks.push({
            id: `qc-${tableName}-${record.id}`,
            text: JSON.stringify(record, null, 2),
            metadata: {
              recordId: record.id,
              tableName: tableName,
              recordType: 'qc_data'
            },
          });
          
          processedCount++;
        }
      }
    }

    console.log(`Generated ${allChunks.length} chunks from ${processedCount} records`);
    
    // Batch embedding for better performance
    const batchSize = 20;
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

    res.json({ 
      ok: true, 
      message: `Successfully processed ${processedCount} QC records into ${allChunks.length} chunks`,
      recordsProcessed: processedCount,
      chunksCreated: allChunks.length,
      storageType: "In-Memory"
    });

  } catch (err: any) {
    console.error("Triggered QC data loading error:", err);
    res.status(500).json({ ok: false, error: err.message ?? "Triggered QC data loading failed" });
  }
});

// New endpoint for processing the combined PostgreSQL database
ingestRouter.post("/load-combined-db", async (req, res) => {
  try {
    console.log('🔄 Loading combined PostgreSQL database...');
    
    const DB_DATA_PATH = path.resolve(__dirname, '../../../combined_db.json');
    
    if (!fs.existsSync(DB_DATA_PATH)) {
      throw new Error(`Combined database file not found at: ${DB_DATA_PATH}`);
    }
    
    console.log('📖 Reading and parsing combined database...');
    const fileContent = fs.readFileSync(DB_DATA_PATH, 'utf-8');
    const combinedData = JSON.parse(fileContent);
    
    console.log('🗺️  Building schema map...');
    await schemaMapper.loadSchema(combinedData);
    
    // Generate schema documentation
    const schemaDocs = schemaMapper.generateSchemaDocumentation();
    console.log('📋 Generated schema documentation with', Object.keys(combinedData).length, 'tables');
    
    const namespace = "combined_db";
    const allChunks: IngestDocument[] = [];
    let processedCount = 0;
    
    // Focus on key tables first
    const priorityTables = [
      'master_inprocessinspectionreading',
      'master_inspectionschedule', 
      'master_plantmaster',
      'master_machinemaster',
      'master_operationmaster',
      'auth_user'
    ];
    
    // Process priority tables first, then others
    const tablesToProcess = [
      ...priorityTables.filter(name => combinedData[name]),
      ...Object.keys(combinedData).filter(name => !priorityTables.includes(name))
    ];
    
    for (const tableName of tablesToProcess) {
      const tableData = combinedData[tableName];
      
      if (!tableData || !tableData.sample_rows || !Array.isArray(tableData.sample_rows)) {
        console.log(`⚠️  Skipping ${tableName} - no sample rows`);
        continue;
      }
      
      console.log(`📊 Processing table: ${tableName} with ${tableData.sample_rows.length} records`);
      
      // Process records in batches to maintain performance
      const batchSize = 50;
      const records = tableData.sample_rows;
      
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        // Convert batch to enhanced text with relationships
        const batchText = enhancedJsonToText.convertManyToText(batch, tableName, {
          includeRelationships: true,
          maxRelationshipDepth: 2
        });
        
        if (batchText.trim().length < 100) continue; // Skip empty batches
        
        // Create chunks from the batch text
        const chunks = chunkText(batchText, 1500, 200);
        
        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const recordIds = batch.map(r => r.id || i + chunkIdx).filter(Boolean);
          
          allChunks.push({
            id: `${tableName}-batch-${Math.floor(i/batchSize)}-chunk-${chunkIdx}`,
            text: chunks[chunkIdx],
            metadata: {
              tableName,
              recordIds: recordIds.slice(0, 10), // Limit to avoid metadata bloat
              recordCount: batch.length,
              batchIndex: Math.floor(i/batchSize),
              chunkIndex: chunkIdx,
              totalChunks: chunks.length,
              tableType: schemaMapper.getTablesByCategory('inspection').includes(tableName) ? 'inspection' :
                        schemaMapper.getTablesByCategory('master').includes(tableName) ? 'master' :
                        schemaMapper.getTablesByCategory('user').includes(tableName) ? 'user' : 'system',
              hasRelationships: (tableData.relationships || []).length > 0
            }
          });
        }
        
        processedCount += batch.length;
        
        if (processedCount % 500 === 0) {
          console.log(`✅ Processed ${processedCount} records from ${tableName}`);
        }
      }
    }
    
    console.log(`📦 Generated ${allChunks.length} chunks from ${processedCount} total records`);
    
    // Add schema documentation as a special chunk
    const schemaChunks = chunkText(schemaDocs, 2000, 300);
    for (let i = 0; i < schemaChunks.length; i++) {
      allChunks.push({
        id: `schema-doc-chunk-${i}`,
        text: schemaChunks[i],
        metadata: {
          tableName: 'schema_documentation',
          recordType: 'schema_info',
          chunkIndex: i,
          totalChunks: schemaChunks.length,
          isSchemaDoc: true
        }
      });
    }
    
    // Batch embedding for better performance
    const embeddingBatchSize = 25;
    let totalEmbedded = 0;
    
    console.log('🧠 Starting embedding process...');
    
    for (let i = 0; i < allChunks.length; i += embeddingBatchSize) {
      const batch = allChunks.slice(i, i + embeddingBatchSize);
      const texts = batch.map((d) => d.text);
      
      const batchNum = Math.floor(i/embeddingBatchSize) + 1;
      const totalBatches = Math.ceil(allChunks.length/embeddingBatchSize);
      console.log(`🔄 Embedding batch ${batchNum}/${totalBatches}`);
      
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
      console.log(`💾 Stored ${totalEmbedded}/${allChunks.length} chunks`);
    }

    res.json({ 
      ok: true, 
      message: `Successfully processed combined PostgreSQL database`,
      tablesProcessed: tablesToProcess.length,
      recordsProcessed: processedCount,
      chunksCreated: allChunks.length,
      namespace,
      schemaDocGenerated: true,
      priorityTablesFound: priorityTables.filter(name => combinedData[name]).length,
      storageType: "Vector Database"
    });
    
  } catch (err: any) {
    console.error("Combined DB loading error:", err);
    res.status(500).json({ 
      ok: false, 
      error: err.message ?? "Combined database loading failed",
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});