import { Router } from "express";
import { z } from "zod";
import { chunkText } from "../utils/chunk";
import { embeddings } from "../services/embeddings";
import { adaptiveVectorStore } from "../services/adaptiveVectorStore";
import type { IngestDocument } from "../types";
import { jsonToText } from "../utils/jsonToText";

export const ingestRouter = Router();

const IngestSchema = z.object({
  namespace: z.string().optional(),
  chunkSize: z.number().int().min(50).max(4000).optional()  .default(800),
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

    await adaptiveVectorStore.upsert(
      allChunks.map((d, i) => ({
        id: d.id,
        text: d.text,
        metadata: d.metadata ?? {},
        embedding: vectors[i],
        namespace: namespace ?? "default",
      }))
    );

    res.json({ ok: true, chunksAdded: allChunks.length, namespace: namespace ?? "default" });
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ ok: false, error: err.message ?? "Ingest failed" });
  }
});

