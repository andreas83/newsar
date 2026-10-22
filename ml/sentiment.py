"""
FinBERT Sentiment Scoring for Stock-Related Articles.

Processes articles linked to stock anomaly events through FinBERT
(ProsusAI/finbert) to generate financial sentiment scores. Updates
article_entities.sentiment for use in ML feature extraction.

The avg_article_sentiment feature already exists in the ML pipeline
but is always NaN without this step.

FinBERT outputs: positive, negative, neutral probabilities.
We store: positive - negative as a single sentiment score (-1 to +1).

Usage: python sentiment.py [--limit 500] [--batch-size 16]

Requires: pip install transformers torch
  (CPU-only torch is fine, ~5 articles/sec on CPU)
"""

import sys
import json
from pathlib import Path

import numpy as np
import pandas as pd

import db

# Lazy imports for transformers (heavy)
_pipeline = None


def get_sentiment_pipeline():
    """Lazy-load FinBERT pipeline."""
    global _pipeline
    if _pipeline is None:
        print('[sentiment] Loading FinBERT model (ProsusAI/finbert)...')
        from transformers import pipeline as hf_pipeline
        _pipeline = hf_pipeline(
            'sentiment-analysis',
            model='ProsusAI/finbert',
            tokenizer='ProsusAI/finbert',
            device=-1,  # CPU
            truncation=True,
            max_length=512,
        )
        print('[sentiment] FinBERT loaded.')
    return _pipeline


def get_articles_for_anomalies(limit: int = 500) -> pd.DataFrame:
    """Get articles linked to stock anomalies that need sentiment scoring."""
    return db.query(f"""
        SELECT DISTINCT
            ae.article_id,
            ae.entity_id,
            a.title,
            SUBSTRING(a.full_content FROM 1 FOR 1000) as content_excerpt,
            ae.sentiment as existing_sentiment,
            a.published_at
        FROM stock_news_correlations c
        JOIN stock_watchlist sw ON sw.id = c.watchlist_id
        JOIN article_entities ae ON ae.entity_id = c.entity_id
        JOIN articles a ON a.id = ae.article_id
        WHERE ae.sentiment IS NULL
          AND a.title IS NOT NULL
          AND a.excluded = false
          AND a.published_at >= c.event_date - INTERVAL '3 days'
          AND a.published_at <= c.event_date + INTERVAL '1 day'
        ORDER BY a.published_at DESC
        LIMIT {int(limit)}
    """)


def score_texts(texts: list[str], batch_size: int = 16) -> list[float]:
    """Score a batch of texts with FinBERT."""
    pipe = get_sentiment_pipeline()
    scores = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        # Clean texts
        batch = [t[:512] if t else '' for t in batch]

        results = pipe(batch)
        for result in results:
            label = result['label']
            score_val = result['score']
            if label == 'positive':
                scores.append(score_val)
            elif label == 'negative':
                scores.append(-score_val)
            else:  # neutral
                scores.append(0.0)

        if (i + batch_size) % 100 == 0 or i + batch_size >= len(texts):
            print(f'  Scored {min(i + batch_size, len(texts))}/{len(texts)} texts')

    return scores


def update_sentiments(article_entity_pairs: list[tuple[int, int]], sentiments: list[float]):
    """Batch update article_entities.sentiment in the database."""
    if not article_entity_pairs:
        return

    # Build batch update
    values = []
    for (article_id, entity_id), sentiment in zip(article_entity_pairs, sentiments):
        values.append(f"({article_id}, {entity_id}, {sentiment:.6f})")

    values_str = ', '.join(values)

    db.execute(f"""
        UPDATE article_entities ae
        SET sentiment = v.sentiment
        FROM (VALUES {values_str}) AS v(article_id, entity_id, sentiment)
        WHERE ae.article_id = v.article_id::int
          AND ae.entity_id = v.entity_id::int
    """)


def main():
    limit = 500
    batch_size = 16

    for i, arg in enumerate(sys.argv):
        if arg == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
        if arg == '--batch-size' and i + 1 < len(sys.argv):
            batch_size = int(sys.argv[i + 1])

    print(f'[sentiment] Fetching articles linked to anomaly events (limit={limit})...')
    articles = get_articles_for_anomalies(limit)

    if articles.empty:
        print('[sentiment] No articles need sentiment scoring.')
        return

    print(f'[sentiment] Found {len(articles)} articles to score.')

    # Prepare texts: use title + content excerpt
    texts = []
    for _, row in articles.iterrows():
        title = str(row.get('title') or '')
        content = str(row.get('content_excerpt') or '')
        text = f"{title}. {content}".strip()
        texts.append(text[:512])

    # Score
    print(f'[sentiment] Running FinBERT on {len(texts)} texts (batch_size={batch_size})...')
    sentiments = score_texts(texts, batch_size=batch_size)

    # Update database
    pairs = list(zip(articles['article_id'].astype(int), articles['entity_id'].astype(int)))
    print(f'[sentiment] Updating {len(pairs)} article_entities.sentiment values...')

    # Update in chunks of 500
    chunk_size = 500
    for i in range(0, len(pairs), chunk_size):
        chunk_pairs = pairs[i:i + chunk_size]
        chunk_sentiments = sentiments[i:i + chunk_size]
        update_sentiments(chunk_pairs, chunk_sentiments)
        print(f'  Updated {min(i + chunk_size, len(pairs))}/{len(pairs)}')

    # Summary stats
    sentiments_arr = np.array(sentiments)
    print(f'\n[sentiment] Done!')
    print(f'  Articles scored: {len(sentiments)}')
    print(f'  Mean sentiment: {sentiments_arr.mean():.4f}')
    print(f'  Positive (>0.1): {(sentiments_arr > 0.1).sum()}')
    print(f'  Negative (<-0.1): {(sentiments_arr < -0.1).sum()}')
    print(f'  Neutral: {((sentiments_arr >= -0.1) & (sentiments_arr <= 0.1)).sum()}')


if __name__ == '__main__':
    main()
