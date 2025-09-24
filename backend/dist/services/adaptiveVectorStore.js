"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adaptiveVectorStore = void 0;
const chromaVectorStore_1 = require("./chromaVectorStore");
const inMemoryVectorStore_1 = require("./inMemoryVectorStore");
class AdaptiveVectorStore {
    constructor() {
        this.isChromaAvailable = false;
        this.activeStore = inMemoryVectorStore_1.vectorStore;
        this.initializeChroma();
    }
    async initializeChroma() {
        try {
            console.log('Testing ChromaDB connection...');
            const isHealthy = await chromaVectorStore_1.chromaVectorStore.healthCheck();
            if (isHealthy) {
                console.log('✅ ChromaDB is available - using persistent storage');
                this.activeStore = chromaVectorStore_1.chromaVectorStore;
                this.isChromaAvailable = true;
            }
            else {
                console.log('⚠️ ChromaDB not available - falling back to in-memory storage');
                this.activeStore = inMemoryVectorStore_1.vectorStore;
            }
        }
        catch (error) {
            console.log('⚠️ ChromaDB initialization failed - using in-memory storage:', error?.message || error);
            this.activeStore = inMemoryVectorStore_1.vectorStore;
        }
    }
    async upsert(records) {
        try {
            return await this.activeStore.upsert(records);
        }
        catch (error) {
            if (this.isChromaAvailable && this.activeStore === chromaVectorStore_1.chromaVectorStore) {
                console.log('ChromaDB upsert failed, falling back to in-memory store:', error?.message || error);
                this.activeStore = inMemoryVectorStore_1.vectorStore;
                this.isChromaAvailable = false;
                return await this.activeStore.upsert(records);
            }
            throw error;
        }
    }
    async query(input) {
        try {
            return await this.activeStore.query(input);
        }
        catch (error) {
            if (this.isChromaAvailable && this.activeStore === chromaVectorStore_1.chromaVectorStore) {
                console.log('ChromaDB query failed, falling back to in-memory store:', error?.message || error);
                this.activeStore = inMemoryVectorStore_1.vectorStore;
                this.isChromaAvailable = false;
                return await this.activeStore.query(input);
            }
            throw error;
        }
    }
    // Utility methods
    getActiveStorageType() {
        return this.activeStore === chromaVectorStore_1.chromaVectorStore ? 'ChromaDB' : 'In-Memory';
    }
    async getStats(namespace) {
        if (this.activeStore === chromaVectorStore_1.chromaVectorStore) {
            return await chromaVectorStore_1.chromaVectorStore.getStats(namespace || 'default');
        }
        return { type: 'in-memory', message: 'Stats not available for in-memory store' };
    }
}
exports.adaptiveVectorStore = new AdaptiveVectorStore();
