export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
}

const EMBEDDING_DIMENSIONS = 1536;
const TIMEOUT_MS = 5000;

export function createEmbeddingClient(
  endpoint: string,
  model: string,
): EmbeddingClient {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: texts, model }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return [];
        }

        const data = await response.json();
        
        if (data.data && Array.isArray(data.data)) {
          const embeddings: number[][] = data.data
            .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
            .map((item: { embedding?: number[] }) => item.embedding || []);
          
          if (embeddings.length > 0 && embeddings[0].length === EMBEDDING_DIMENSIONS) {
            return embeddings;
          }
        }

        return [];
      } catch {
        return [];
      }
    },
  };
}
