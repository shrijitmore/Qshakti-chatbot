import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GOOGLE_API_KEY;
const hasKey = typeof apiKey === "string" && apiKey.length > 0;

// Lazy init client
let client: GoogleGenerativeAI | null = null;
function getClient() {
  if (!client) client = new GoogleGenerativeAI(apiKey || "");
  return client;
}

export const embeddings = {
  async embedMany(texts: string[]): Promise<number[][]> {
    if (!hasKey) {
      // Fallback: simple deterministic hash-based embedding (not semantic)
      return texts.map((t) => fauxEmbed(t));
    }
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const vectors: number[][] = [];
    for (const text of texts) {
      const res = await model.embedContent({
        content: { parts: [{ text }] },
      } as any);
      // Some SDK versions expose res.embedding.values directly
      const vec = (res as any).embedding?.values || (res as any).data?.[0]?.embedding?.values;
      if (!vec) throw new Error("Embedding response missing values");
      vectors.push(vec);
    }
    return vectors;
  },
};

function fauxEmbed(text: string): number[] {
  // Simple 256-dim hashing
  const dim = 256;
  const v = new Array(dim).fill(0);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
    v[h % dim] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}
