export type VectorRecord = {
  id: string;
  text: string;
  metadata: Record<string, any>;
  embedding: number[];
  namespace: string;
};

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(input: { namespace: string; embedding: number[]; topK: number }): Promise<VectorRecord[]>;
}
