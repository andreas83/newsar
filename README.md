# Newsar - AI-Powered News Aggregation Platform

A Nuxt 4 application that collects news from multiple sources, classifies articles using local AI (Ollama), and groups similar stories for comprehensive multi-perspective news coverage.

## Features

✅ **RSS Feed Collection** - Collects from 6 major news sources
✅ **Content Extraction** - Full article text extraction using Mozilla Readability
✅ **AI Classification** - Language detection, political bias, entity extraction
✅ **Vector Embeddings** - Semantic similarity search with pgvector
✅ **Story Clustering** - Automatically groups related articles
✅ **Content Analysis** - Keywords, summaries, and sentiment analysis

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 16 with pgvector extension
- Ollama (for AI features)

### Installation

```bash
# Install dependencies
npm install

# Set up database
createdb newsar
psql newsar -c "CREATE EXTENSION vector;"

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Push schema to database
npm run db:push

# Seed RSS feeds
npm run seed:feeds

# Download Ollama models
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

### Usage

```bash
# 1. Collect articles from RSS feeds
npm run test:fetch

# 2. Extract full content
npm run extract:all 50 3

# 3. Classify articles (language, bias, entities)
npm run classify:all 50 2

# 4. Generate embeddings for similarity search
npm run embed:all 50 3

# 5. Analyze articles (keywords, summary, sentiment)
npm run analyze:all 50 1

# 6. Group similar stories
npm run test:cluster 0.75 2
```

## Available Commands

### Testing
```bash
npm run test:fetch              # Test RSS parsing
npm run test:classify [id]      # Test classification
npm run test:similarity [id]    # Test similarity search
npm run test:analyze [id]       # Test analysis pipeline
```

### Batch Processing
```bash
npm run extract:all [limit] [concurrency]   # Extract content
npm run classify:all [limit] [concurrency]  # Classify articles
npm run embed:all [limit] [concurrency]     # Generate embeddings
npm run analyze:all [limit] [concurrency]   # Analyze content
```

## Tech Stack

- **Frontend:** Nuxt 4, UnoCSS, Nuxt UI
- **Backend:** Nuxt Server API, Drizzle ORM
- **Database:** PostgreSQL 16 + pgvector
- **AI:** Ollama (llama3.2:3b, nomic-embed-text)
- **Content:** Mozilla Readability, rss-parser

## Architecture

```
RSS Feeds → Content Extraction → Classification → Embeddings → Clustering → Analysis
   ↓              ↓                    ↓              ↓            ↓          ↓
Articles   Full Content      Language/Bias/    Similarity   Story Groups  Keywords/
                              Entities          Search                     Summaries/
                                                                           Sentiment
```

## Current Status

**Phases Complete:** 1-7 (Backend ML Pipeline + Admin Dashboard)
**Articles Collected:** 288
**Content Extracted:** 58 articles
**Classified:** 3 articles
**Embeddings:** 3 generated
**Entities:** 13+ extracted

**Admin Dashboard:** ✅ Complete - Access at `/admin` after running `npm run dev`
**Next:** Phase 8 (Public Interface)

## Performance

| Task | Time per Article | Recommended Concurrency |
|------|------------------|------------------------|
| Content Extraction | 3-5s | 3-5 |
| Classification | 30s | 1-2 |
| Embedding Generation | 5s | 3-5 |
| Analysis | 35s | 1 |

## Documentation

- **[IMPLEMENTATION.md](./IMPLEMENTATION.md)** - Complete technical documentation
- **[CLAUDE.md](./CLAUDE.md)** - Project requirements and phases

## Configuration

### RSS Feeds
Edit `server/scripts/seedFeeds.ts` to add/modify news sources.

### Ollama Models
- **Chat:** llama3.2:3b (2GB) - Fast, local, good for classification
- **Embeddings:** nomic-embed-text (274MB) - 768 dimensions

### Database
14 tables with full schema in `server/database/schema.ts`

## Troubleshooting

**Ollama not running:**
```bash
ollama serve
```

**Database connection issues:**
```bash
# Test connection
PGPASSWORD=your_password psql -h localhost -U your_user -d newsar
```

**Redis not available:**
Use batch scripts (`extract:all`, `classify:all`) instead of queue scripts.

## Development

```bash
# Start development server
npm run dev

# Database management
npm run db:studio      # Open Drizzle Studio
npm run db:push        # Push schema changes

# Run workers (optional, requires Redis)
npm run worker:feed
```

## License

Private project

---

**Built with Nuxt 4 • Ollama • PostgreSQL • pgvector**
