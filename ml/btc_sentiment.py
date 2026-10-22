"""
FinBERT Sentiment Scoring for BTC-Related Articles.

Targets articles linked to Bitcoin (entity search by name) and Cryptocurrency entities.
Same pattern as sentiment.py but for crypto entity set.

Usage: python btc_sentiment.py [--limit 500] [--batch-size 16]
"""

import sys
import numpy as np
import pandas as pd

import db

_pipeline = None


def get_sentiment_pipeline():
    global _pipeline
    if _pipeline is None:
        print('[btc_sentiment] Loading FinBERT model...')
        from transformers import pipeline as hf_pipeline
        _pipeline = hf_pipeline(
            'sentiment-analysis',
            model='ProsusAI/finbert',
            tokenizer='ProsusAI/finbert',
            device=-1,
            truncation=True,
            max_length=512,
        )
        print('[btc_sentiment] FinBERT loaded.')
    return _pipeline


def get_crypto_articles(limit: int = 500) -> pd.DataFrame:
    return db.query(f"""
        SELECT DISTINCT
            ae.article_id,
            ae.entity_id,
            a.title,
            SUBSTRING(a.full_content FROM 1 FOR 1000) as content_excerpt,
            ae.sentiment as existing_sentiment,
            a.published_at
        FROM article_entities ae
        JOIN articles a ON a.id = ae.article_id
        JOIN entities e ON e.id = ae.entity_id
        WHERE ae.sentiment IS NULL
          AND a.title IS NOT NULL
          AND a.excluded = false
          AND (e.name ILIKE '%bitcoin%' OR e.name ILIKE '%cryptocurrency%'
               OR e.name ILIKE '%crypto%' OR e.name ILIKE '%blockchain%')
          AND e.name NOT ILIKE '%crypto.com arena%'
        ORDER BY a.published_at DESC
        LIMIT {int(limit)}
    """)


def score_texts(texts, batch_size=16):
    pipe = get_sentiment_pipeline()
    scores = []
    for i in range(0, len(texts), batch_size):
        batch = [t[:512] if t else '' for t in texts[i:i + batch_size]]
        results = pipe(batch)
        for result in results:
            label = result['label']
            score_val = result['score']
            if label == 'positive':
                scores.append(score_val)
            elif label == 'negative':
                scores.append(-score_val)
            else:
                scores.append(0.0)
        if (i + batch_size) % 100 == 0 or i + batch_size >= len(texts):
            print(f'  Scored {min(i + batch_size, len(texts))}/{len(texts)} texts')
    return scores


def update_sentiments(pairs, sentiments):
    if not pairs:
        return
    values = []
    for (article_id, entity_id), sentiment in zip(pairs, sentiments):
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

    print(f'[btc_sentiment] Fetching crypto articles (limit={limit})...')
    articles = get_crypto_articles(limit)

    if articles.empty:
        print('[btc_sentiment] No articles need sentiment scoring.')
        return

    print(f'[btc_sentiment] Found {len(articles)} articles to score.')

    texts = []
    for _, row in articles.iterrows():
        title = str(row.get('title') or '')
        content = str(row.get('content_excerpt') or '')
        texts.append(f"{title}. {content}"[:512])

    print(f'[btc_sentiment] Running FinBERT on {len(texts)} texts...')
    sentiments = score_texts(texts, batch_size=batch_size)

    pairs = list(zip(articles['article_id'].astype(int), articles['entity_id'].astype(int)))
    print(f'[btc_sentiment] Updating {len(pairs)} sentiment values...')

    for i in range(0, len(pairs), 500):
        chunk_pairs = pairs[i:i + 500]
        chunk_sentiments = sentiments[i:i + 500]
        update_sentiments(chunk_pairs, chunk_sentiments)

    arr = np.array(sentiments)
    print(f'\n[btc_sentiment] Done! Scored: {len(sentiments)}, Mean: {arr.mean():.4f}')


if __name__ == '__main__':
    main()
