import fs from 'fs';
import path from 'path';
import type { VectorRecord, VectorStore } from "./vectorStore";

const STORAGE_DIR = path.join(process.cwd(), '.vector_storage');
const db: Record<string, VectorRecord[]> = Object.create(null);

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Load existing data from disk
function loadNamespace(namespace: string): VectorRecord[] {
  const filePath = path.join(STORAGE_DIR, `${namespace}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data || [];
    } catch (err) {
      console.warn(`Failed to load namespace ${namespace}:`, err);
      return [];
    }
  }
  return [];
}

// Save namespace data to disk
function saveNamespace(namespace: string, records: VectorRecord[]) {
  const filePath = path.join(STORAGE_DIR, `${namespace}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
  } catch (err) {
    console.error(`Failed to save namespace ${namespace}:`, err);
  }
}

export const vectorStore: VectorStore = {
  async upsert(records) {
    for (const r of records) {
      if (!db[r.namespace]) {
        db[r.namespace] = loadNamespace(r.namespace);
      }
      // Replace if id exists
      const idx = db[r.namespace].findIndex((x) => x.id === r.id);
      if (idx >= 0) db[r.namespace][idx] = r;
      else db[r.namespace].push(r);

      // Save to disk
      saveNamespace(r.namespace, db[r.namespace]);
    }
  },

  async query({ namespace, embedding, topK }) {
    const list = db[namespace] ?? loadNamespace(namespace);
    const scored = list.map((r) => ({ r, score: cosine(r.embedding, embedding) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((x) => x.r);
  },
};

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = (Math.sqrt(na) * Math.sqrt(nb)) || 1;
  return dot / d;
}
