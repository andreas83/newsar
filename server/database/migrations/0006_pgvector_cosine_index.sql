CREATE INDEX IF NOT EXISTS article_embeddings_cosine_idx
  ON article_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
