# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Newsar** is an AI-powered news aggregation platform that collects RSS feeds, classifies articles using local AI (Ollama via RunPod), generates embeddings for semantic similarity, clusters articles into stories, and provides multi-perspective news analysis.

**Vision:** Combat disinformation by providing comprehensive news coverage from multiple perspectives, pre-classified by political bias, enabling users to form evidence-based judgments.

## Architecture

### Data Flow Pipeline

```
RSS Feeds → Content Extraction → Classification → Embeddings → Clustering → Analysis
   ↓              ↓                    ↓              ↓            ↓          ↓
Articles   Full Content      Language/Bias/    Similarity   Story Groups  Keywords/
                              Entities          Search                     Summaries
```

### Three-Tier Processing

1. **Collection Layer** (`server/services/rssParser.ts`, `server/services/contentExtractor.ts`)
   - RSS feed polling with deduplication (SHA-256 content hash)
   - Mozilla Readability for full-text extraction
   - Image extraction with local storage

2. **ML Pipeline** (`server/services/`)
   - **Classification**: Hybrid approach (rule-based for known sources + Ollama for unknown)
   - **Embeddings**: nomic-embed-text (768 dimensions) via Ollama
   - **Clustering**: DBSCAN-like algorithm groups similar articles into "stories"
   - **Analysis**: Keywords, summaries (3 lengths), sentiment, entity summaries

3. **Entity System** (`server/services/entityExtractor.ts`, `server/services/entitySummarizer.ts`)
   - Named Entity Recognition (PERSON, ORGANIZATION, LOCATION, EVENT)
   - AI-generated entity summaries with trending scores
   - Entity pages with article links and relationships

### Database Schema (PostgreSQL + pgvector)

**Core Tables:**
- `feeds`: RSS feed sources with known bias (-1 to +1 scale)
- `articles`: News articles with processing status tracking
- `classifications`: Language, political bias, entities per article
- `article_embeddings`: 768-dimensional vectors for semantic search
- `keywords`: Extracted keywords with relevance scores and categories
- `analyses`: Summaries, sentiment, and metadata

**Story Grouping:**
- `stories`: Clustered article groups with trending scores
- `story_members`: Article-to-story relationships with representative flag
- `story_coverage`: Political bias distribution (left/center/right counts)
- `story_metrics`: Time-series trending data

**Entity System:**
- `entities`: People, organizations, locations, events with slugs
- `article_entities`: Article-entity links with relevance and sentiment
- `entity_summaries`: AI-generated summaries, trending scores, mention counts
- `story_entities`: Pre-computed entity-story relationships

### Workers & Queues (BullMQ + Redis)

**Workers:**
- `server/workers/feedWorker.ts`: Processes feed fetch, extraction, classification, embeddings, analysis
- `server/workers/topicRelationshipWorker.ts`: Computes topic relationships and entity connections

**Queue System:**
- `server/queues/feedQueue.ts`: Job queue management for article pipeline
- `server/queues/topicRelationshipQueue.ts`: Topic computation jobs
- Priority levels: 5 (breaking), 10 (recent), 15 (fresh), 30 (old)

### Auto Pipeline (`server/services/autoPipeline.ts`)

Monitors system load and automatically queues jobs:
- Checks every 5 minutes
- Respects CPU (80%) and memory (85%) thresholds
- Automatically queues: extraction → classification → embeddings → analysis
- Triggers topic relationship computation after story updates

## OSINT Network Graph (NEW)

**Entity Network Visualization** for intelligence analysis showing relationships between people, organizations, locations, and events.

**Quick Start:**
```bash
# 1. Compute entity relationships from articles
npm run relationships:compute 2

# 2. View network graph
Open: http://localhost:3050/admin/network

# 3. Find connections between entities
Use the Path Finding tool in the UI
```

**Features:**
- D3.js force-directed graph visualization
- Timeline filtering (7/30/90 days, all time)
- Shortest path finding between any two entities
- Co-occurrence patterns and sentiment correlation
- Interactive zoom, pan, drag, and filter

**See:** `NETWORK_GRAPH_OSINT.md` for detailed documentation

## Common Commands

### Development

```bash
npm run dev                    # Start development server (port 3050)
npm run build                  # Build for production
pm2 restart newsar             # Restart main app in production
pm2 restart newsar-worker      # Restart feed worker
pm2 restart newsar-topic-worker # Restart topic worker
pm2 logs newsar                # View logs
```

### Database

```bash
npm run db:push                # Push schema changes to database
npm run db:studio              # Open Drizzle Studio UI
npm run db:generate            # Generate migrations
npm run seed:feeds             # Seed initial RSS feeds

# Direct PostgreSQL access
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U newsar -d newsar
```

### Article Processing Pipeline

**Manual batch processing (no Redis required):**

```bash
# 1. Fetch articles from all active feeds
npm run fetch:all

# 2. Extract full content (limit, concurrency)
npm run extract:all 50 3

# 3. Classify articles (language, bias, entities)
npm run classify:all 50 2

# 4. Generate embeddings for similarity search
npm run embed:all 50 3

# 5. Analyze articles (keywords, summaries, sentiment)
npm run analyze:all 50 1

# 6. Cluster articles into stories
npm run test:cluster 0.75 2
```

**Queue-based processing (requires Redis):**

```bash
npm run queue:pipeline         # Queue full pipeline for all articles
npm run queue:extract          # Queue content extraction only
npm run queue:images           # Queue image extraction only
```

### Entity Management

```bash
npm run entities:summarize     # Generate AI summaries for top 20 entities
npm run relationships:compute  # Compute entity co-occurrence relationships for network graph
```

### Testing Individual Steps

```bash
npm run test:fetch             # Test RSS parsing
npm run test:extract [id]      # Test content extraction for article ID
npm run test:classify [id]     # Test classification for article ID
npm run test:similarity [id]   # Test similarity search for article ID
npm run test:analyze [id]      # Test analysis for article ID
npm run test:topics            # Test topic relationship computation
```

## Key Technical Details

### Ollama Configuration

**Production uses RunPod:**
- Base URL: `https://gotobumnnlizii-11434.proxy.runpod.net`
- Chat model: `qwen2.5:14b-instruct-q5_K_M` (for classification, analysis, summaries)
- Embedding model: `nomic-embed-text` (768 dimensions)

**Environment variables** (`.env` or `ecosystem.config.cjs`):
```bash
OLLAMA_BASE_URL=https://gotobumnnlizii-11434.proxy.runpod.net
OLLAMA_CHAT_MODEL=qwen2.5:14b-instruct-q5_K_M
OLLAMA_EMBED_MODEL=nomic-embed-text
```

### RunPod On-Demand Pod Management (NEW)

**Cost Optimization System** for AI processing that automatically manages cloud GPU pods based on workload demand, reducing costs by 70-80% compared to always-on infrastructure.

#### Overview

The RunPod system provides fully automated lifecycle management of cloud GPU pods:
- **Automatic creation**: Pods spin up when Ollama jobs are queued
- **Health monitoring**: Continuous checks for pod and Ollama availability
- **Idle termination**: Pods automatically shut down after 15 minutes of inactivity
- **Cost tracking**: Real-time cost monitoring with daily spending limits
- **Graceful fallback**: Falls back to static Ollama URL if RunPod unavailable

**Cost Savings:**
- Always-on: ~$252-360/month ($0.40/hr × 24hr × 30 days)
- On-demand: ~$72/month (70-80% reduction)
- Cold start penalty: 2-3 minutes (with pre-loaded Docker image)

#### Architecture Components

**Core Services:**

1. **`server/utils/runpodClient.ts`** (367 lines) - RunPod GraphQL API wrapper
   - Pod lifecycle: `createPod()`, `getPodStatus()`, `terminatePod()`
   - Status polling: `waitForPodRunning()` with timeout
   - URL extraction from pod proxy endpoints

2. **`server/services/runpodManager.ts`** (436 lines) - Pod orchestration
   - Redis-backed state persistence (survives app restarts)
   - Activity tracking with `recordActivity()` and `getTimeSinceLastActivity()`
   - Cost calculation: `getDailyCost()`, respects `RUNPOD_MAX_COST_PER_DAY`
   - Health checks: `checkOllamaHealth()`, verifies model availability
   - Singleton pattern: `getRunPodManager()` ensures single instance

3. **`server/services/podIdleMonitor.ts`** (193 lines) - Automatic idle shutdown
   - Runs every 2 minutes (configurable)
   - Checks: idle time > `RUNPOD_POD_IDLE_TIMEOUT` (default 15 min) AND no pending Ollama jobs
   - Gracefully terminates pods to save costs
   - Logs all actions for audit trail

**Integration Points:**

4. **`server/utils/ollama.ts`** - Dynamic URL resolution
   - `getPrimaryUrl()`: Checks RunPod manager for active pod URL
   - Falls back to `OLLAMA_BASE_URL` if RunPod disabled or pod not ready
   - Resets Ollama client when URL changes (pod lifecycle events)

5. **`server/queues/feedQueue.ts`** - Pod creation trigger
   - `ensurePodAvailable()`: Creates pod when Ollama jobs are queued
   - Applied to: classifications, embeddings, analyses
   - Non-blocking: pod creation runs in background

6. **`server/workers/feedWorker.ts`** - Worker integration
   - `waitForPodReady()`: Workers wait up to 5 minutes for pod
   - `recordPodActivity()`: Resets idle timer on job completion
   - BullMQ retry logic handles cold start delays

7. **`server/plugins/initPipeline.ts`** - Startup initialization
   - Initializes RunPodManager with env config
   - Starts PodIdleMonitor with 2-minute interval
   - Only runs if `RUNPOD_ENABLED=true`

#### Configuration

**Required Environment Variables:**

```bash
# Core RunPod settings
RUNPOD_API_KEY=rpa_...                      # RunPod API key (required)
RUNPOD_TEMPLATE_ID=abcd1234                 # Pre-built Docker template ID (required)
RUNPOD_GPU_TYPE=NVIDIA RTX 4090             # GPU type to request
RUNPOD_ENABLED=true                         # Enable on-demand management (default: false)

# Behavior settings
RUNPOD_POD_IDLE_TIMEOUT=900000              # 15 minutes in ms (default)
RUNPOD_MAX_PODS=1                           # Max concurrent pods (default: 1)
RUNPOD_MAX_COST_PER_DAY=20                  # Daily spending limit in USD (default: $20)
```

**Docker Template Setup:**

The system requires a pre-built Docker image with Ollama + models to minimize cold start time:

```dockerfile
# Dockerfile.ollama - Pre-loads both models during build
FROM ollama/ollama:latest

ENV OLLAMA_HOST=0.0.0.0:11434
ENV OLLAMA_ORIGINS=*

RUN ollama serve & \
    sleep 5 && \
    ollama pull nomic-embed-text && \
    ollama pull qwen2.5:14b-instruct-q5_K_M && \
    pkill ollama

EXPOSE 11434
CMD ["ollama", "serve"]
```

**Build and Deploy:**
1. Build image: `docker build -f Dockerfile.ollama -t yourusername/ollama-newsar:latest .`
2. Push to registry: `docker push yourusername/ollama-newsar:latest`
3. Create RunPod template using the image (via RunPod web UI)
4. Copy template ID to `RUNPOD_TEMPLATE_ID` in config

**See:** `RUNPOD_RUNBOOK.md` for complete setup instructions and troubleshooting

#### Pod Lifecycle States

Pods progress through these states:

```
PENDING → STARTING → READY/ACTIVE → IDLE → TERMINATING → TERMINATED
```

- **PENDING**: Pod creation requested, waiting for GPU allocation
- **STARTING**: Pod assigned to GPU, container starting
- **READY**: Pod running, Ollama server responding (not processing jobs)
- **ACTIVE**: Pod processing Ollama jobs
- **IDLE**: No activity for X minutes, will auto-terminate soon
- **TERMINATING**: Shutdown in progress
- **TERMINATED**: Pod destroyed, no longer billable

#### Admin Dashboard & API

**Admin UI:** `/admin` page includes `AdminRunPodStatusCard` component

**Features:**
- Real-time status with color indicators (green/yellow/blue/orange/gray)
- Pod metrics: uptime, jobs processed, session cost, daily cost
- Idle timer with percentage indicator
- Savings badge showing % vs always-on
- Manual controls: Create, Terminate, Restart
- Auto-refresh every 30 seconds

**API Endpoints:**

```bash
# Status overview
GET /api/admin/runpod/status
# Returns: pod state, metrics, costs, idle monitor status

# Manual pod control
POST /api/admin/runpod/control
# Body: { action: 'create' | 'terminate' | 'restart' }

# Cost analytics
GET /api/admin/runpod/cost?period=today|week|month
# Returns: costs, savings calculations, cost per job

# Health diagnostics
GET /api/admin/runpod/health
# Returns: pod health, Ollama health, model availability

# Idle monitor status
GET /api/admin/runpod/idle?forceCheck=true
# Returns: idle timing, time until termination
```

#### Operational Guidelines

**Normal Operation:**

1. Auto-pipeline queues jobs → `ensurePodAvailable()` triggers pod creation
2. Workers wait for pod ready (max 5 min) → process jobs
3. Each job completion → `recordActivity()` resets idle timer
4. After 15 min idle + no pending jobs → idle monitor terminates pod
5. Next job arrives → cycle repeats

**Cold Start Handling:**

- Pre-built image: 2-3 minute cold start (model loading skipped)
- Workers wait up to 5 minutes via `waitForPodReady()`
- BullMQ retry logic handles transient failures
- Jobs remain queued during cold start

**Cost Management:**

- `getDailyCost()` tracks spend since midnight UTC
- Rejects pod creation if daily limit exceeded
- Monitor via dashboard or API
- Adjust `RUNPOD_MAX_COST_PER_DAY` as needed

**Failure Modes:**

- Pod creation fails → logs error, jobs wait for next creation attempt
- Pod becomes unhealthy → idle monitor terminates, new pod created on demand
- RunPod API unavailable → falls back to static `OLLAMA_BASE_URL`
- Daily cost limit hit → no new pods until next day

#### Monitoring & Troubleshooting

**Log Locations:**
```bash
pm2 logs newsar                # Main app logs
pm2 logs newsar-worker         # Worker logs (shows pod waits)
pm2 logs newsar-topic-worker   # Topic worker logs
```

**Key Log Patterns:**
- `[RunPodManager] Creating new pod` - Pod creation started
- `[RunPodManager] Pod ready` - Pod ready for jobs
- `[PodIdleMonitor] Terminating idle pod` - Auto-shutdown triggered
- `[FeedQueue] No active pod, creating new pod` - Queue triggered creation
- `[Worker] Waiting for pod to be ready` - Worker waiting for cold start

**Common Issues:**

1. **Pod stuck in PENDING**: Check GPU availability in RunPod dashboard
2. **High costs**: Review `RUNPOD_POD_IDLE_TIMEOUT`, may be too long
3. **Jobs timing out**: Increase worker timeout, check pod health
4. **Pod won't terminate**: Check for stuck jobs, force terminate via API

**Health Checks:**
```bash
# Check pod status
curl http://localhost:3050/api/admin/runpod/status

# Force health check
curl http://localhost:3050/api/admin/runpod/health

# Force idle check (triggers termination if conditions met)
curl http://localhost:3050/api/admin/runpod/idle?forceCheck=true
```

**Manual Operations:**
```bash
# Restart PM2 processes to reload config
pm2 restart newsar newsar-worker newsar-topic-worker

# Disable RunPod temporarily (use static URL)
# Set RUNPOD_ENABLED=false in ecosystem.config.cjs, then:
pm2 restart all

# Clear stuck pod state in Redis
redis-cli DEL runpod:current_pod runpod:daily_cost
```

#### Files Reference

**Core Implementation:**
- `server/utils/runpodClient.ts` - API wrapper
- `server/services/runpodManager.ts` - Pod manager
- `server/services/podIdleMonitor.ts` - Idle monitor
- `server/plugins/initPipeline.ts` - Initialization

**Integration:**
- `server/utils/ollama.ts` - Dynamic URL resolution
- `server/queues/feedQueue.ts` - Pod creation trigger
- `server/workers/feedWorker.ts` - Worker integration

**Admin Interface:**
- `app/components/admin/RunPodStatusCard.vue` - Dashboard card
- `server/api/admin/runpod/*.ts` - 5 API endpoints

**Configuration:**
- `ecosystem.config.cjs` - PM2 config with env vars
- `.env.example` - Environment variable docs
- `Dockerfile.ollama` - Docker image definition

**Documentation:**
- `RUNPOD_RUNBOOK.md` - Complete operational guide (1,200+ lines)

### Political Bias Scale

- **-1.0 to -0.6**: Far Left
- **-0.6 to -0.2**: Center-Left
- **-0.2 to +0.2**: Center
- **+0.2 to +0.6**: Center-Right
- **+0.6 to +1.0**: Far Right

Stored in `feeds.known_bias` and `classifications.political_bias`.

### Processing Status Flow

Articles track their pipeline progress:

```
pending → content_extracted → classified → embedded → analyzed → grouped
```

Status fields:
- `articles.processing_status`: 'pending', 'grouped', 'refined'
- `articles.extraction_status`: 'pending', 'success', 'failed', 'skipped'
- `classifications.entity_extraction_done`: boolean

### Performance Benchmarks

| Task | Time/Article | Concurrency | Model |
|------|-------------|-------------|-------|
| Content Extraction | 3-5s | 3-5 | Puppeteer |
| Classification | 25-30s | 1-2 | qwen2.5:14b |
| Embedding | 5s | 3-5 | nomic-embed-text |
| Analysis | 35s | 1 | qwen2.5:14b |
| Entity Summary | 10-15s | 1 | qwen2.5:14b |

### Nitro Route Patterns

**Important:** Nitro doesn't fully support nested dynamic routes like `[type]/[slug].get.ts`.

✅ **Use catch-all pattern:**
```typescript
// server/api/entities/[...params].get.ts
const params = getRouterParam(event, 'params')
const [type, slug] = params.split('/')
```

❌ **Don't use nested structure:**
```typescript
// server/api/entities/[type]/[slug].get.ts (won't work reliably)
```

### Custom UI Components

**Important:** Nuxt UI is NOT installed. Use custom components from `app/components/`:

```vue
<Button to="/path" label="Click" />
<Card>Content</Card>
<Badge color="blue">Text</Badge>
<Icon name="i-heroicons-user" />
<Progress :value="50" />
<Container>Page content</Container>
```

Do NOT use `<UButton>`, `<UCard>`, etc. - they don't exist in this project.

### Entity Linking System

Entities are automatically detected and linked in article content:

**Backend:** `server/services/entityExtractor.ts` extracts entities during classification
**Frontend:** `app/composables/useEntityLinker.ts` + `app/components/EntityLink.vue`

Entity types are color-coded:
- 🔵 Person (blue)
- 🟢 Organization (green)
- 🟠 Location (orange)
- 🟣 Event (purple)

Entity pages follow pattern: `/entities/{type}/{slug}` (e.g., `/entities/person/donald-trump`)

## Project Structure

```
app/
├── components/          # Custom UI components (Badge, Button, Card, etc.)
├── composables/         # Vue composables (useEntityLinker)
├── layouts/            # Default and admin layouts
├── pages/
│   ├── admin/          # Admin dashboard pages
│   ├── articles/       # Article detail pages
│   ├── stories/        # Story coverage pages
│   ├── topics/         # Trending topics/entities
│   ├── [type]/[slug]/  # Entity pages (person, location, org, event)
│   └── index.vue       # Homepage

server/
├── api/                # Nuxt server API endpoints
│   ├── admin/          # Admin API (feeds, articles, jobs, stats)
│   ├── articles/       # Article endpoints
│   ├── entities/       # Entity endpoints (trending, preview, detail)
│   ├── stories/        # Story endpoints
│   └── topics/         # Topic/keyword endpoints
├── database/
│   ├── db.ts           # PostgreSQL connection singleton
│   └── schema.ts       # Drizzle ORM schema (14 tables)
├── services/           # Core business logic
│   ├── rssParser.ts
│   ├── contentExtractor.ts
│   ├── articleClassifier.ts
│   ├── biasClassifier.ts
│   ├── entityExtractor.ts
│   ├── embeddingGenerator.ts
│   ├── articleClustering.ts
│   ├── articleAnalyzer.ts
│   ├── entitySummarizer.ts
│   ├── autoPipeline.ts
│   └── storyTrending.ts
├── queues/             # BullMQ job queues
│   ├── feedQueue.ts
│   └── topicRelationshipQueue.ts
├── workers/            # Background workers
│   ├── feedWorker.ts
│   └── topicRelationshipWorker.ts
├── scripts/            # Batch processing scripts
│   ├── batchFetch.ts
│   ├── batchExtract.ts
│   ├── batchClassify.ts
│   ├── batchEmbed.ts
│   ├── batchAnalyze.ts
│   ├── generateEntitySummaries.ts
│   └── updateStoryTrending.ts
└── utils/              # Ollama client, Redis, helpers
```

## Entity Summary Generation

Entity summaries are generated using AI and include:
- Short description (max 500 chars)
- Full summary
- Trending score (based on recent mentions and velocity)
- Mention count across all articles

**Generate summaries:**
```bash
npm run entities:summarize
```

This processes the top 20 entities by trending score and creates/updates their summaries in the `entity_summaries` table.

## PM2 Production Setup

Three processes run in production:

1. **newsar** (port 3050): Main Nuxt app, cluster mode
2. **newsar-worker**: Feed processing worker (extraction, classification, etc.)
3. **newsar-topic-worker**: Topic relationship computation

All configured in `ecosystem.config.cjs` with environment variables.

## Important Notes

### Story Trending System

Stories have dynamic trending scores based on:
- Article velocity (new articles per hour)
- Recency (decay over 48 hours)
- Source diversity (number of unique feeds)

Updated by `server/scripts/updateStoryTrending.ts` (should be run periodically).

### Priority Queue System

Articles are prioritized for processing:
- Priority 5: Breaking news (< 1 hour old, story trending > 0.5)
- Priority 10: Recent (< 6 hours old)
- Priority 15: Fresh (< 24 hours old)
- Priority 30: Old (> 24 hours)

This ensures breaking news gets processed first.

### Image Handling

Images are downloaded and stored locally:
- Stored in: `public/images/articles/`
- Fallback to original URL if local fetch fails
- Status tracked in `articles.image_fetch_status`

## Current System State

**Phase 7 Complete:** Admin dashboard fully functional at `/admin`
**Phase 8 In Progress:** Public interface review and improvements

**What's Working Well (reviewed 2026-03-22):**
- `/stories` - Functional, card design can be polished later
- `/articles` - Very insightful, no changes needed
- `/location/` - Good summary and article lists
- `/person/` - Working well
- `/organisation/` - Working well
- Entity pages with summaries, related articles, and related entities

**Known Issues / Next Steps:**
- `/topics/graph` - D3 graph drifts off-screen (bug)
- `/topics` - Replace with entity browser (keep graph component)
- `/` (frontpage) - Needs redesign (project intro, or entity-grouped stories)
- See `FUTURE_IMPROVEMENTS.md` for full roadmap

**Architecture Decisions:**
- Using cron over worker for scheduled tasks
- Processing pipeline: cron-based batch scripts

**Statistics:**
- 2300+ entities extracted
- 23+ entities with AI summaries
- Articles processed through full ML pipeline
- Story clustering active with trending scores