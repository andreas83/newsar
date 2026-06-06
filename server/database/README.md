# Database Setup

This directory contains the database schema and migrations for the Newsar platform.

## Prerequisites

1. **PostgreSQL with pgvector extension**
   ```bash
   # Install PostgreSQL (if not already installed)
   # Ubuntu/Debian:
   sudo apt-get install postgresql postgresql-contrib

   # Install pgvector extension
   # Follow instructions at: https://github.com/pgvector/pgvector

   # Create database
   createdb newsar

   # Enable pgvector extension in your database
   psql newsar -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```

2. **Environment Variables**
   Copy `.env.example` to `.env` and update the database credentials:
   ```bash
   cp .env.example .env
   ```

## Database Commands

### Generate Migrations
Generate SQL migration files from schema changes:
```bash
npm run db:generate
```

### Apply Migrations
Apply pending migrations to the database:
```bash
npm run db:migrate
```

### Push Schema
Push schema changes directly to the database (for development):
```bash
npm run db:push
```

### Database Studio
Open Drizzle Studio to browse and edit data:
```bash
npm run db:studio
```

### Drop Tables
Drop all tables (use with caution!):
```bash
npm run db:drop
```

## Schema Overview (14 Tables)

**Core Tables (7):**
- **feeds**: RSS feed sources with bias/region classification
- **articles**: News articles (+ story_id, processing_status for workflow)
- **classifications**: Article language and bias (+ entity extraction tracking)
- **article_embeddings**: Vector embeddings for semantic search (pgvector)
- **keywords**: Extracted keywords from articles
- **sources_config**: Domain rules for hybrid classification
- **article_modifications**: Track changes to articles over time

**Stories & Trending (4):**
- **stories**: Clustered similar stories with trending metrics
- **story_members**: Many-to-many stories ↔ articles
- **story_coverage**: Coverage diversity metrics (left/center/right balance)
- **story_metrics**: Time-series metrics for trending detection

**Entity Tracking (3):**
- **entities**: Named entities (people, organizations, locations, events)
- **article_entities**: Links articles to entities they mention
- **story_entities**: Pre-computed entity → story mapping

**See SCHEMA_OVERVIEW.md for detailed documentation and query patterns.**

## First Time Setup

1. Create PostgreSQL database and enable pgvector extension
2. Update `.env` with database credentials
3. Generate and apply migrations:
   ```bash
   npm run db:generate
   npm run db:push
   ```

## Development Workflow

1. Modify schema in `schema.ts`
2. Generate migration: `npm run db:generate`
3. Review generated SQL in `migrations/` directory
4. Apply migration: `npm run db:migrate`
