# Newsar — Multi-Perspective News Intelligence Platform

> Combat disinformation by surfacing every side of a story. Newsar aggregates news from dozens of RSS feeds, classifies each article by political bias using local AI, clusters related coverage into unified stories, and lets readers compare how left, center, and right outlets frame the same events.

**Live demo:** [newsar.codejungle.org](https://newsar.codejungle.org/)

![Newsar Homepage](docs/screenshots/screenshot-hero.png)

---

## Table of Contents

- [Why Newsar?](#why-newsar)
- [Key Features](#key-features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Processing Pipeline](#processing-pipeline)
- [Entity Intelligence](#entity-intelligence)
- [OSINT Network Graph](#osint-network-graph)
- [RunPod GPU Management](#runpod-gpu-management)
- [Admin Dashboard](#admin-dashboard)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Why Newsar?

Traditional news aggregators show you a single perspective. Social media algorithms amplify what you already believe. Newsar takes a different approach:

1. **Collect broadly** — RSS feeds from outlets across the political spectrum, in multiple languages
2. **Classify automatically** — Local AI models detect language, extract named entities, and score each article's political bias on a -1.0 (far left) to +1.0 (far right) scale
3. **Cluster into stories** — Vector embeddings + DBSCAN-like clustering group articles about the same event, regardless of source
4. **Reveal the full picture** — Each story shows how many left, center, and right sources covered it, with side-by-side perspective comparison

The result: readers can see what's being reported, what's being omitted, and how framing differs across the political spectrum.

---

## Key Features

### News Aggregation & Analysis
- **Multi-source RSS collection** with deduplication (SHA-256 content hashing)
- **Full-text extraction** using Mozilla Readability + Puppeteer fallback
- **AI classification** — language detection, political bias scoring, named entity recognition
- **Semantic embeddings** — 768-dimensional vectors (nomic-embed-text) for similarity search
- **Story clustering** — DBSCAN algorithm groups related articles into unified stories
- **Content analysis** — keyword extraction, 3-length summaries, sentiment scoring

### Entity Intelligence
- **Named Entity Recognition** — People, Organizations, Locations, Events
- **Entity pages** with AI-generated summaries, related articles, and relationship maps
- **Trending entities** with velocity-based scoring
- **Wikidata enrichment** for entity portraits and metadata

### Visualization & Exploration
- **Interactive world map** — Leaflet-based geospatial view of news hotspots
- **OSINT network graph** — D3.js force-directed graph showing entity relationships
- **Story coverage analysis** — Left/Center/Right perspective breakdown per story
- **Trending bubbles** — Visual representation of trending topics

### Infrastructure
- **On-demand GPU pods** — RunPod integration creates/destroys cloud GPU instances based on workload, reducing AI compute costs by 70-80%
- **Priority job queue** — BullMQ with priority levels (breaking news processed first)
- **Auto-pipeline** — Monitors system load, automatically queues processing jobs
- **Admin dashboard** — Full operational control panel with real-time metrics

---

## Screenshots

### Homepage — Categorized Story Feed
![Homepage](docs/screenshots/screenshot-hero.png)
*Lead story with hero image, categorized sections (Politics, Conflict, Economy, Diplomacy, Society, Health), trending wire, and latest intel feed with bias indicators.*

### Story Coverage — Multi-Perspective View
![Stories](docs/screenshots/screenshot-stories.png)
*Browse 50+ clustered stories. Filter by region, entity, keyword, or time range. View trending stories and switch between list, region, person, org, and keyword views.*

### Entity Browser — People, Orgs, Locations, Events
![Entities](docs/screenshots/screenshot-entities.png)
*Explore 1,100+ extracted entities with AI portraits. Filter by type, country, role, or political party. Trending section highlights entities with highest mention velocity.*

### Live Operations Map
![Map](docs/screenshots/screenshot-map.png)
*Geospatial news map showing where stories are breaking. Filter by severity, category, or time. Live operations view with country-level article distribution.*

---

## Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    DATA PIPELINE                        │
                    │                                                         │
  RSS Feeds ──────► │  Fetch ──► Extract ──► Classify ──► Embed ──► Analyze  │
  (50+ sources)     │    │          │            │           │          │      │
                    │    ▼          ▼            ▼           ▼          ▼      │
                    │ Articles  Content    Language/     Vectors    Keywords/  │
                    │           (Readability) Bias/      (768-dim)  Summaries/ │
                    │                      Entities     (pgvector)  Sentiment  │
                    └────────────────────────┬────────────────────────────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                         ┌─────────┐   ┌──────────┐   ┌──────────┐
                         │ Cluster │   │  Entity   │   │ Trending │
                         │ Stories │   │ Summaries │   │  Scores  │
                         └─────────┘   └──────────┘   └──────────┘
                              │              │              │
                    ┌─────────┴──────────────┴──────────────┴─────────┐
                    │                 PRESENTATION                     │
                    │                                                   │
                    │  Homepage ─ Stories ─ Entities ─ Map ─ Graph     │
                    │  Search ─ Sources ─ Markets ─ Admin Dashboard    │
                    └─────────────────────────────────────────────────┘
```

### Three-Tier Processing

| Layer | Purpose | Key Services |
|-------|---------|-------------|
| **Collection** | Gather and deduplicate news | `rssParser.ts`, `contentExtractor.ts` |
| **ML Pipeline** | Classify, embed, cluster, analyze | `articleClassifier.ts`, `embeddingGenerator.ts`, `articleClustering.ts`, `articleAnalyzer.ts` |
| **Entity System** | NER, summaries, relationships | `entityExtractor.ts`, `entitySummarizer.ts`, `topicRelationshipWorker.ts` |

### Database Design

PostgreSQL with pgvector extension. 14+ tables:

| Table Group | Tables | Purpose |
|-------------|--------|---------|
| **Core** | `feeds`, `articles` | Source management and article storage |
| **ML** | `classifications`, `article_embeddings`, `keywords`, `analyses` | AI pipeline outputs |
| **Stories** | `stories`, `story_members`, `story_coverage`, `story_metrics` | Article clustering and trending |
| **Entities** | `entities`, `article_entities`, `entity_summaries`, `story_entities` | Named entity graph |

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | [Nuxt 4](https://nuxt.com/) (Vue 3, Nitro server) |
| **Styling** | [UnoCSS](https://unocss.dev/) (atomic CSS) |
| **Database** | PostgreSQL 16 + [pgvector](https://github.com/pgvector/pgvector) |
| **ORM** | [Drizzle ORM](https://orm.drizzle.team/) |
| **AI/ML** | [Ollama](https://ollama.ai/) (qwen2.5:14b, nomic-embed-text) |
| **Job Queue** | [BullMQ](https://docs.bullmq.io/) + Redis |
| **Content** | [Mozilla Readability](https://github.com/mozilla/readability), [Puppeteer](https://pptr.dev/) |
| **Visualization** | [D3.js](https://d3js.org/), [Leaflet](https://leafletjs.com/), [vis-network](https://visjs.github.io/vis-network/) |
| **Cloud GPU** | [RunPod](https://www.runpod.io/) (on-demand pod management) |
| **Process Manager** | [PM2](https://pm2.keymetrics.io/) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 16 with [pgvector extension](https://github.com/pgvector/pgvector)
- Redis (for job queue; optional for batch processing)
- Ollama (local or remote via RunPod)

### Installation

```bash
# Clone the repository
git clone https://github.com/andreas83/newsar.git
cd newsar

# Install dependencies
npm install

# Set up PostgreSQL
createdb newsar
psql newsar -c "CREATE EXTENSION vector;"

# Configure environment
cp .env.example .env
# Edit .env with your database credentials and Ollama URL

# Push database schema
npm run db:push

# Seed RSS feeds
npm run seed:feeds

# Start development server
npm run dev
# App available at http://localhost:3050
```

### Ollama Models

```bash
# If running Ollama locally:
ollama pull qwen2.5:14b-instruct-q5_K_M   # Classification & analysis
ollama pull nomic-embed-text                # Embeddings (768 dimensions)
```

---

## Processing Pipeline

Articles flow through a 6-stage pipeline. Each stage can be run independently via CLI scripts (no Redis required) or queued through BullMQ for automated processing.

### Manual Batch Processing

```bash
# 1. Fetch articles from all active feeds
npm run fetch:all

# 2. Extract full article content (limit, concurrency)
npm run extract:all 50 3

# 3. Classify: language, political bias, named entities
npm run classify:all 50 2

# 4. Generate 768-dim embeddings for similarity search
npm run embed:all 50 3

# 5. Analyze: keywords, summaries (short/medium/long), sentiment
npm run analyze:all 50 1

# 6. Cluster related articles into stories
npm run test:cluster 0.75 2
```

### Queue-Based Processing (requires Redis)

```bash
npm run queue:pipeline    # Queue full pipeline for all pending articles
npm run queue:extract     # Queue content extraction only
npm run queue:images      # Queue image extraction only
```

### Auto-Pipeline

The auto-pipeline monitors system resources and automatically queues jobs:
- Checks every 5 minutes
- Respects CPU (80%) and memory (85%) thresholds
- Chains stages: extraction -> classification -> embeddings -> analysis
- Triggers story clustering after updates

### Priority System

| Priority | Criteria | Use Case |
|----------|----------|----------|
| 5 | < 1 hour old, trending > 0.5 | Breaking news |
| 10 | < 6 hours old | Recent news |
| 15 | < 24 hours old | Fresh content |
| 30 | > 24 hours | Backfill |

### Article Status Flow

```
pending → content_extracted → classified → embedded → analyzed → grouped
```

### Performance Benchmarks

| Stage | Time per Article | Concurrency | Model Used |
|-------|-----------------|-------------|------------|
| Content Extraction | 3-5s | 3-5 | Puppeteer/Readability |
| Classification | 25-30s | 1-2 | qwen2.5:14b |
| Embedding | 5s | 3-5 | nomic-embed-text |
| Analysis | 35s | 1 | qwen2.5:14b |

---

## Entity Intelligence

Newsar extracts and tracks four types of named entities across all articles:

| Type | Examples | Color Code |
|------|----------|-----------|
| **Person** | Heads of state, public figures | Blue |
| **Organization** | Government agencies, companies, NGOs | Green |
| **Location** | Countries, cities, regions | Orange |
| **Event** | Wars, elections, summits | Purple |

### Features

- **Automatic extraction** during article classification via LLM
- **Entity pages** with AI-generated summaries, related articles, and co-occurring entities
- **Trending scores** based on mention velocity and recency
- **Wikidata integration** for entity portraits and structured metadata
- **Entity linking** in article content (inline clickable entity references)

### Generate Entity Summaries

```bash
npm run entities:summarize          # AI summaries for top 20 trending entities
npm run relationships:compute 2     # Compute co-occurrence relationships
```

---

## OSINT Network Graph

An intelligence-analysis tool for exploring entity relationships extracted from news coverage.

- **D3.js force-directed graph** showing co-occurrence networks
- **Timeline filtering** — 7, 30, 90 days, or all time
- **Path finding** — Shortest path between any two entities
- **Sentiment correlation** — How entities are discussed together
- **Interactive controls** — Zoom, pan, drag, filter by entity type

Access at `/admin/network` or `/topics/graph`.

---

## RunPod GPU Management

Newsar includes a cost-optimization system that manages cloud GPU pods on-demand, reducing AI compute costs by 70-80% compared to always-on infrastructure.

### How It Works

1. **Job queued** — When classification/embedding/analysis jobs arrive, the system checks for an active GPU pod
2. **Pod created** — If no pod exists, one is created via RunPod API with a pre-built Docker image (Ollama + models)
3. **Jobs processed** — Workers wait for pod readiness (2-3 min cold start), then process jobs
4. **Auto-shutdown** — After 15 minutes of inactivity with no pending jobs, the pod is terminated
5. **Cost tracking** — Real-time monitoring with daily spending limits

### Cost Comparison

| Mode | Monthly Cost |
|------|-------------|
| Always-on GPU | ~$252-360/mo |
| On-demand (Newsar) | ~$72/mo |
| **Savings** | **70-80%** |

### Configuration

```bash
RUNPOD_ENABLED=true
RUNPOD_API_KEY=rpa_...
RUNPOD_TEMPLATE_ID=abcd1234
RUNPOD_GPU_TYPE="NVIDIA RTX 4090"
RUNPOD_POD_IDLE_TIMEOUT=900000      # 15 min
RUNPOD_MAX_COST_PER_DAY=20          # $20/day limit
```

---

## Admin Dashboard

Protected admin panel at `/admin` with:

- **System statistics** — Article counts, processing status, feed health
- **Feed management** — Add/edit/delete RSS sources, trigger fetches
- **Job queue monitor** — View pending/active/completed jobs, retry failed
- **RunPod control** — Pod status, costs, manual create/terminate
- **Entity management** — Trigger summarization, review extractions
- **Story management** — Review clusters, adjust trending

---

## Project Structure

```
app/
├── components/           # 43 custom Vue components
│   ├── admin/           #   Admin dashboard cards
│   ├── Badge.vue        #   UI primitives (no Nuxt UI dependency)
│   ├── Button.vue
│   ├── Card.vue
│   ├── StoryCard.vue    #   Story display
│   ├── EntityLink.vue   #   Inline entity references
│   ├── NetworkGraph.vue #   D3 network visualization
│   └── ...
├── composables/          # Vue composables (useEntityLinker, useLanguage)
├── layouts/              # Default and admin layouts
└── pages/                # 35 pages
    ├── index.vue         #   Homepage with categorized stories
    ├── stories/          #   Story listing and detail views
    ├── articles/         #   Article detail with entity linking
    ├── entities/         #   Entity browser
    ├── [type]/[slug]/    #   Entity detail pages (person, org, location, event)
    ├── map.vue           #   Geospatial news map
    ├── topics/           #   Topic graph visualization
    ├── stocks/           #   Market data and signals
    └── admin/            #   Admin dashboard (9 pages)

server/
├── api/                  # 73 API endpoints
│   ├── admin/           #   Admin operations, RunPod control
│   ├── articles/        #   Article CRUD and search
│   ├── entities/        #   Entity browsing, trending, preview
│   ├── stories/         #   Story listing and detail
│   ├── network/         #   OSINT graph data
│   └── ...
├── database/
│   ├── db.ts            # PostgreSQL connection singleton
│   └── schema.ts        # Drizzle ORM schema (14+ tables)
├── services/             # Core business logic
│   ├── rssParser.ts
│   ├── contentExtractor.ts
│   ├── articleClassifier.ts
│   ├── biasClassifier.ts
│   ├── entityExtractor.ts
│   ├── embeddingGenerator.ts
│   ├── articleClustering.ts
│   ├── articleAnalyzer.ts
│   ├── entitySummarizer.ts
│   ├── runpodManager.ts
│   ├── podIdleMonitor.ts
│   ├── autoPipeline.ts
│   └── storyTrending.ts
├── workers/              # BullMQ background workers
│   ├── feedWorker.ts
│   └── topicRelationshipWorker.ts
├── queues/               # Job queue definitions
├── scripts/              # Batch processing CLI scripts
└── utils/                # Ollama client, Redis, RunPod API
```

---

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/newsar

# Ollama AI
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5:14b-instruct-q5_K_M
OLLAMA_EMBED_MODEL=nomic-embed-text

# Redis (optional - for queue-based processing)
REDIS_URL=redis://localhost:6379

# RunPod (optional - for cloud GPU)
RUNPOD_ENABLED=false
RUNPOD_API_KEY=rpa_...
RUNPOD_TEMPLATE_ID=...
```

See `.env.example` for the complete list.

### Political Bias Scale

| Range | Label |
|-------|-------|
| -1.0 to -0.6 | Far Left |
| -0.6 to -0.2 | Center-Left |
| -0.2 to +0.2 | Center |
| +0.2 to +0.6 | Center-Right |
| +0.6 to +1.0 | Far Right |

Bias is stored per-feed (`feeds.known_bias`) for known sources and computed via LLM for unknown sources.

### Production Deployment (PM2)

```bash
npm run build
pm2 start ecosystem.config.cjs
```

Three PM2 processes:
1. **newsar** (port 3050) — Main Nuxt application
2. **newsar-worker** — Feed processing worker
3. **newsar-topic-worker** — Topic relationship computation

---

## API Reference

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/frontpage` | Homepage data (stories by category, trending, latest) |
| GET | `/api/stories` | List stories with filtering (sort, region, entity, keyword) |
| GET | `/api/stories/:id` | Story detail with all member articles and coverage analysis |
| GET | `/api/articles` | List articles with pagination and filters |
| GET | `/api/articles/:id` | Article detail with classification and analysis |
| GET | `/api/entities/trending` | Trending entities with velocity scores |
| GET | `/api/entities/browse` | Browse entities by type, country, role |
| GET | `/api/search` | Full-text search across articles |
| GET | `/api/search/semantic` | Vector similarity search |
| GET | `/api/network/graph` | Entity relationship graph data |
| GET | `/api/network/path` | Shortest path between two entities |
| GET | `/api/map/hotspots` | Geospatial news hotspot data |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | System statistics |
| POST | `/api/admin/jobs/queue` | Queue processing jobs |
| GET | `/api/admin/runpod/status` | RunPod pod status and metrics |
| POST | `/api/admin/runpod/control` | Create/terminate/restart pods |

---

## Common Commands

```bash
# Development
npm run dev                         # Start dev server (port 3050)
npm run build                       # Production build

# Database
npm run db:push                     # Push schema changes
npm run db:studio                   # Open Drizzle Studio

# Processing pipeline
npm run fetch:all                   # Fetch all RSS feeds
npm run extract:all 50 3            # Extract content
npm run classify:all 50 2           # Classify articles
npm run embed:all 50 3              # Generate embeddings
npm run analyze:all 50 1            # Analyze articles
npm run test:cluster 0.75 2         # Cluster into stories

# Entities
npm run entities:summarize          # Generate entity summaries
npm run relationships:compute       # Compute entity relationships

# Production
pm2 restart newsar                  # Restart app
pm2 logs newsar                     # View logs
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

Private project. All rights reserved.

---

<p align="center">
  <strong>Built with Nuxt 4 &middot; Ollama &middot; PostgreSQL &middot; pgvector</strong>
  <br>
  <a href="https://newsar.codejungle.org/">Live Demo</a>
</p>
