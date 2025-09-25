import { ChromaClient, Collection } from 'chromadb';
import type { VectorStore, VectorRecord } from './vectorStore';

class ChromaVectorStore implements VectorStore {
  private client: ChromaClient;
  private collections: Map<string, Collection> = new Map();

  constructor() {
    this.client = new ChromaClient({
      path: "http://localhost:8000", // Default ChromaDB server path
    });
  }

  private async getCollection(namespace: string): Promise<Collection> {
    if (this.collections.has(namespace)) {
      return this.collections.get(namespace)!;
    }

    try {
      // Try to get existing collection
      const collection = await this.client.getCollection({
        name: namespace,
      });
      this.collections.set(namespace, collection);
      return collection;
    } catch (error) {
      // Collection doesn't exist, create it
      const collection = await this.client.createCollection({
        name: namespace,
        metadata: { 
          description: `QC Data collection for namespace: ${namespace}`,
          created_at: new Date().toISOString()
        },
      });
      this.collections.set(namespace, collection);
      return collection;
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    // Group records by namespace
    const recordsByNamespace = new Map<string, VectorRecord[]>();
    for (const record of records) {
      const ns = record.namespace || 'default';
      if (!recordsByNamespace.has(ns)) {
        recordsByNamespace.set(ns, []);
      }
      recordsByNamespace.get(ns)!.push(record);
    }

    // Upsert to each namespace collection
    for (const [namespace, nsRecords] of recordsByNamespace) {
      const collection = await this.getCollection(namespace);
      
      await collection.upsert({
        ids: nsRecords.map(r => r.id),
        embeddings: nsRecords.map(r => r.embedding),
        documents: nsRecords.map(r => r.text),
        metadatas: nsRecords.map(r => ({
          ...r.metadata,
          namespace: r.namespace,
          ingested_at: new Date().toISOString()
        })),
      });
    }
  }

  async query(input: { 
    namespace: string; 
    embedding: number[]; 
    topK: number; 
  }): Promise<VectorRecord[]> {
    const collection = await this.getCollection(input.namespace);
    
    const results = await collection.query({
      queryEmbeddings: [input.embedding],
      nResults: input.topK,
    });

    if (!results.ids || !results.ids[0] || results.ids[0].length === 0) {
      return [];
    }

    const records: VectorRecord[] = [];
    const ids = results.ids[0];
    const documents = results.documents?.[0] || [];
    const metadatas = results.metadatas?.[0] || [];
    const distances = results.distances?.[0] || [];

    for (let i = 0; i < ids.length; i++) {
      records.push({
        id: ids[i],
        text: documents[i] || '',
        metadata: {
          ...((metadatas[i] as Record<string, any>) || {}),
          similarity_score: 1 - (distances[i] || 0), // Convert distance to similarity
        },
        embedding: [], // ChromaDB doesn't return embeddings in query
        namespace: input.namespace,
      });
    }

    return records;
  }

  // Utility method to check ChromaDB connection
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.heartbeat();
      return true;
    } catch (error) {
      console.error('ChromaDB health check failed:', error);
      return false;
    }
  }

  // Method to clear all data (useful for testing)
  async clearNamespace(namespace: string): Promise<void> {
    try {
      await this.client.deleteCollection({ name: namespace });
      this.collections.delete(namespace);
    } catch (error) {
      console.log(`Collection ${namespace} may not exist, continuing...`);
    }
  }

  // Get collection stats
  async getStats(namespace: string): Promise<{ count: number; name: string }> {
    try {
      const collection = await this.getCollection(namespace);
      const count = await collection.count();
      return { count, name: namespace };
    } catch (error) {
      return { count: 0, name: namespace };
    }
  }
}

export const chromaVectorStore = new ChromaVectorStore();