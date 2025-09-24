import type { VectorStore } from './vectorStore';
import { chromaVectorStore } from './chromaVectorStore';
import { vectorStore as inMemoryVectorStore } from './inMemoryVectorStore';

class AdaptiveVectorStore implements VectorStore {
  private activeStore: VectorStore;
  private isChromaAvailable: boolean = false;

  constructor() {
    this.activeStore = inMemoryVectorStore;
    this.initializeChroma();
  }

  private async initializeChroma() {
    try {
      console.log('Testing ChromaDB connection...');
      const isHealthy = await chromaVectorStore.healthCheck();
      
      if (isHealthy) {
        console.log('✅ ChromaDB is available - using persistent storage');
        this.activeStore = chromaVectorStore;
        this.isChromaAvailable = true;
      } else {
        console.log('⚠️ ChromaDB not available - falling back to in-memory storage');
        this.activeStore = inMemoryVectorStore;
      }
    } catch (error) {
      console.log('⚠️ ChromaDB initialization failed - using in-memory storage:', error.message);
      this.activeStore = inMemoryVectorStore;
    }
  }

  async upsert(records: Parameters<VectorStore['upsert']>[0]): Promise<void> {
    try {
      return await this.activeStore.upsert(records);
    } catch (error: any) {
      if (this.isChromaAvailable && this.activeStore === chromaVectorStore) {
        console.log('ChromaDB upsert failed, falling back to in-memory store:', error?.message || error);
        this.activeStore = inMemoryVectorStore;
        this.isChromaAvailable = false;
        return await this.activeStore.upsert(records);
      }
      throw error;
    }
  }

  async query(input: Parameters<VectorStore['query']>[0]): Promise<ReturnType<VectorStore['query']>> {
    try {
      return await this.activeStore.query(input);
    } catch (error) {
      if (this.isChromaAvailable && this.activeStore === chromaVectorStore) {
        console.log('ChromaDB query failed, falling back to in-memory store:', error.message);
        this.activeStore = inMemoryVectorStore;
        this.isChromaAvailable = false;
        return await this.activeStore.query(input);
      }
      throw error;
    }
  }

  // Utility methods
  getActiveStorageType(): string {
    return this.activeStore === chromaVectorStore ? 'ChromaDB' : 'In-Memory';
  }

  async getStats(namespace?: string): Promise<any> {
    if (this.activeStore === chromaVectorStore) {
      return await chromaVectorStore.getStats(namespace || 'default');
    }
    return { type: 'in-memory', message: 'Stats not available for in-memory store' };
  }
}

export const adaptiveVectorStore = new AdaptiveVectorStore();