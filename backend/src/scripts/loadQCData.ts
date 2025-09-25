import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const QC_DATA_PATH = path.resolve(__dirname, '../../JSON data/schema.json');
const BACKEND_URL = `http://localhost:${process.env.PORT || 3001}`;

async function loadQCData() {
  console.log('Starting QC data loading process...');
  
  try {
    // Read the local QC data file
    console.log(`Reading QC data from local file: ${QC_DATA_PATH}`);
    if (!fs.existsSync(QC_DATA_PATH)) {
      throw new Error(`Data file not found at: ${QC_DATA_PATH}`);
    }
    const fileContent = fs.readFileSync(QC_DATA_PATH, 'utf-8');
    const qcData = JSON.parse(fileContent);
    console.log(`Fetched ${Array.isArray(qcData) ? qcData.length : 'unknown'} records`);
    
    // Send to ingestion endpoint
    console.log('Sending data to ingestion endpoint...');
    const ingestResponse = await fetch(`${BACKEND_URL}/ingest/qc-data`, {
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
    
    const result = await ingestResponse.json() as any;
    console.log('✅ QC Data ingestion completed successfully!');
    console.log('📊 Results:', {
      recordsProcessed: result.recordsProcessed,
      chunksCreated: result.chunksCreated,
      storageType: result.storageType,
      stats: result.stats
    });
    
  } catch (error: any) {
    console.error('❌ QC data loading failed:', error?.message || error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  loadQCData();
}

export { loadQCData };