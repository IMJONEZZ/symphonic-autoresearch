import fs from "node:fs";
import path from "node:path";
import type { EmbeddingClient } from "./embedding-client.js";

export interface Document {
  id: number;
  text: string;
  source: string;
  timestamp: string;
}

const MAX_TEXT_LENGTH = 2000;

interface USearchIndex {
  add(keys: BigUint64Array, vectors: Float32Array | Float64Array, threads: number): void;
  search(vectors: Float32Array | Float64Array, k: number, threads: number): {
    keys: BigUint64Array;
    distances: Float32Array;
  };
  save(path: string): void;
  load(path: string): void;
  size(): number;
}

export class KnowledgeStore {
  private index: USearchIndex | null = null;
  private documents: Map<number, Document> = new Map();
  private nextId: number = 1;
  private initialized: boolean = false;
  private embedWarningLogged: boolean = false;

  constructor(
    private storePath: string,
    private embeddingClient: EmbeddingClient,
    private dimensions: number = 1536,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const usearch = await import("usearch");
      this.index = new usearch.Index(this.dimensions, usearch.MetricKind.Cos) as unknown as USearchIndex;
      
      const loaded = this.load();
      if (!loaded) {
        this.documents.clear();
        this.nextId = 1;
      }
    } catch (err) {
      console.error("[KnowledgeStore] Failed to initialize USearch:", err);
      this.index = null;
    }

    this.initialized = true;
  }

  async addDocument(text: string, source: string): Promise<number | null> {
    if (!this.index) return null;

    const truncatedText = text.length > MAX_TEXT_LENGTH 
      ? text.slice(0, MAX_TEXT_LENGTH) 
      : text;

    const embeddings = await this.embeddingClient.embed([truncatedText]);
    
    if (embeddings.length === 0 || embeddings[0].length !== this.dimensions) {
      if (!this.embedWarningLogged) {
        console.warn("[KnowledgeStore] Embedding endpoint unavailable, skipping document storage");
        this.embedWarningLogged = true;
      }
      return null;
    }

    const id = this.nextId++;
    const doc: Document = {
      id,
      text: truncatedText,
      source,
      timestamp: new Date().toISOString(),
    };

    try {
      const keys = BigUint64Array.of(BigInt(id));
      const vector = new Float32Array(embeddings[0]);
      this.index.add(keys, vector, 1);
      this.documents.set(id, doc);
      this.save();
      return id;
    } catch (err) {
      console.error("[KnowledgeStore] Failed to add document:", err);
      return null;
    }
  }

  async search(query: string, topK = 5): Promise<string[]> {
    if (!this.index || this.documents.size === 0) return [];

    const embeddings = await this.embeddingClient.embed([query]);
    
    if (embeddings.length === 0 || embeddings[0].length !== this.dimensions) {
      return [];
    }

    try {
      const vector = new Float32Array(embeddings[0]);
      const results = this.index.search(vector, topK, 1);

      const hits: string[] = [];
      for (let i = 0; i < results.keys.length && hits.length < topK; i++) {
        const key = Number(results.keys[i]);
        const doc = this.documents.get(key);
        if (doc) {
          hits.push(doc.text);
        }
      }
      return hits;
    } catch (err) {
      console.error("[KnowledgeStore] Search failed:", err);
      return [];
    }
  }

  save(): void {
    if (!this.index || !this.initialized) return;

    try {
      fs.mkdirSync(this.storePath, { recursive: true });
      
      const indexPath = path.join(this.storePath, "index.usearch");
      this.index.save(indexPath);

      const docsPath = path.join(this.storePath, "documents.json");
      const docsData = {
        documents: Array.from(this.documents.values()),
        nextId: this.nextId,
      };
      fs.writeFileSync(docsPath, JSON.stringify(docsData, null, 2));
    } catch (err) {
      console.error("[KnowledgeStore] Failed to save:", err);
    }
  }

  load(): boolean {
    if (!this.index) return false;

    try {
      const indexPath = path.join(this.storePath, "index.usearch");
      const docsPath = path.join(this.storePath, "documents.json");

      if (!fs.existsSync(indexPath) || !fs.existsSync(docsPath)) {
        return false;
      }

      this.index.load(indexPath);

      const docsData = JSON.parse(fs.readFileSync(docsPath, "utf-8"));
      
      this.documents.clear();
      for (const entry of docsData.documents || []) {
        this.documents.set(entry.id, {
          id: entry.id,
          text: entry.text,
          source: entry.source,
          timestamp: entry.timestamp,
        });
      }
      this.nextId = docsData.nextId || 1;

      return true;
    } catch (err) {
      console.error("[KnowledgeStore] Failed to load, recreating:", err);
      return false;
    }
  }
}
