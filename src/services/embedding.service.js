function getConfig() {
  return {
    url: process.env.EMBEDDING_API_URL,
    token: process.env.AI_API_TOKEN,
  };
}

const embeddingCache = new Map();
const CACHE_MAX_SIZE = 500;

async function getEmbedding(text) {
  const cacheKey = text.slice(0, 200);
  if (embeddingCache.has(cacheKey)) return embeddingCache.get(cacheKey);

  const { url, token } = getConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  const embedding = data.embeddings[0];

  if (embeddingCache.size >= CACHE_MAX_SIZE) {
    const firstKey = embeddingCache.keys().next().value;
    embeddingCache.delete(firstKey);
  }
  embeddingCache.set(cacheKey, embedding);

  return embedding;
}

async function getEmbeddings(texts) {
  const { url, token } = getConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: texts }),
  });

  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  return data.embeddings;
}

export default { getEmbedding, getEmbeddings };
