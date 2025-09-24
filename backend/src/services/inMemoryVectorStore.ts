import type { VectorRecord, VectorStore } from "./vectorStore";

const db: Record<string, VectorRecord[]> = Object.create(null);

export const vectorStore: VectorStore = {
  async upsert(records) {
    for (const r of records) {
      if (!db[r.namespace]) db[r.namespace] = [];
      // Replace if id exists
      const idx = db[r.namespace].findIndex((x) => x.id === r.id);
      if (idx >= 0) db[r.namespace][idx] = r;
      else db[r.namespace].push(r);
    }
  },

  async query({ namespace, embedding, topK }) {
    const list = db[namespace] ?? [];
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
