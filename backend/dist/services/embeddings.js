"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embeddings = void 0;
const generative_ai_1 = require("@google/generative-ai");
const apiKey = process.env.GOOGLE_API_KEY;
const hasKey = typeof apiKey === "string" && apiKey.length > 0;
// Lazy init client
let client = null;
function getClient() {
    if (!client)
        client = new generative_ai_1.GoogleGenerativeAI(apiKey || "");
    return client;
}
exports.embeddings = {
    async embedMany(texts) {
        if (!hasKey) {
            // Fallback: simple deterministic hash-based embedding (not semantic)
            return texts.map((t) => fauxEmbed(t));
        }
        const genAI = getClient();
        const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const vectors = [];
        for (const text of texts) {
            const res = await model.embedContent({
                content: { parts: [{ text }] },
            });
            // Some SDK versions expose res.embedding.values directly
            const vec = res.embedding?.values || res.data?.[0]?.embedding?.values;
            if (!vec)
                throw new Error("Embedding response missing values");
            vectors.push(vec);
        }
        return vectors;
    },
};
function fauxEmbed(text) {
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
