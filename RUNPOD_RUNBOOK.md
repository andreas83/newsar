# RunPod On-Demand Pod Management Runbook

This document provides operational procedures for managing the RunPod on-demand pod system for Newsar's AI processing.

## Table of Contents

1. [System Overview](#system-overview)
2. [Initial Setup](#initial-setup)
3. [Docker Template Creation](#docker-template-creation)
4. [RunPod Configuration](#runpod-configuration)
5. [Deployment](#deployment)
6. [Monitoring & Operations](#monitoring--operations)
7. [Troubleshooting](#troubleshooting)
8. [Cost Management](#cost-management)
9. [Emergency Procedures](#emergency-procedures)

---

## System Overview

### Architecture

**Pure On-Demand System:**
- Pods are created automatically when Ollama jobs (classification, embedding, analysis) are queued
- Pods terminate automatically after 15 minutes of idle time
- Pre-built Docker template contains models, enabling 2-3 minute cold starts

**Cost Savings:**
- Always-on: ~$252-360/month
- On-demand: ~$72/month
- **Savings: 70-80% ($180-288/month)**

### Components

1. **Docker Image:** `newsar/ollama:latest` with pre-loaded models
2. **RunPod Template:** GPU pod configuration based on Docker image
3. **Pod Manager:** `server/services/runpodManager.ts` handles lifecycle
4. **Idle Monitor:** `server/services/podIdleMonitor.ts` handles termination
5. **Queue Integration:** Auto-creates pods when Ollama jobs arrive

---

## Initial Setup

### Prerequisites

- Docker installed locally for building images
- Docker Hub account (or RunPod container registry access)
- RunPod account with API access
- RunPod API key

### Step 1: Obtain RunPod API Key

1. Log into [RunPod](https://www.runpod.io/)
2. Navigate to Settings → API Keys
3. Click "Create API Key"
4. Name it: `newsar-production`
5. Copy the key (starts with `runpod-...`)
6. Store securely in password manager

### Step 2: Verify Current Pod

Before proceeding, check your current manual pod:

```bash
# Check current Ollama URL
echo $OLLAMA_BASE_URL
# Should show: https://zcioupu4wtxb3w-11434.proxy.runpod.net

# Test connectivity
curl https://zcioupu4wtxb3w-11434.proxy.runpod.net/api/tags

# Note the pod ID from RunPod dashboard for reference
```

**Important:** The on-demand system will replace this manual pod. Plan downtime for migration.

---

## Docker Template Creation

### Step 1: Build Docker Image Locally

```bash
cd /var/www/newsar.codejungle.org

# Build the image (this will take 30-40 minutes due to model downloads)
docker build -f Dockerfile.ollama -t newsar/ollama:latest .

# Expected output:
# - Pulling nomic-embed-text (~274MB) - 1-2 minutes
# - Pulling qwen2.5:14b-instruct-q5_K_M (~9GB) - 20-30 minutes
# - Models pulled successfully

# Verify the build
docker images | grep newsar/ollama
```

### Step 2: Test Image Locally

```bash
# Run container locally to verify
docker run -d --name test-ollama -p 11434:11434 newsar/ollama:latest

# Wait 10 seconds for startup
sleep 10

# Test model availability
curl http://localhost:11434/api/tags

# Should return JSON with both models:
# - qwen2.5:14b-instruct-q5_K_M
# - nomic-embed-text

# Test embedding generation
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "test"
}'

# Test chat completion
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:14b-instruct-q5_K_M",
  "prompt": "Say hello",
  "stream": false
}'

# Clean up
docker stop test-ollama && docker rm test-ollama
```

### Step 3: Push to Docker Hub

```bash
# Login to Docker Hub
docker login
# Enter your Docker Hub credentials

# Tag the image with your Docker Hub username
# Replace 'yourusername' with your actual Docker Hub username
docker tag newsar/ollama:latest yourusername/newsar-ollama:latest

# Push to Docker Hub
docker push yourusername/newsar-ollama:latest

# This will take 20-30 minutes (pushing ~10GB)

# Once complete, your image is available at:
# docker.io/yourusername/newsar-ollama:latest
```

**Alternative: RunPod Container Registry**

If you prefer to use RunPod's registry:

```bash
# Tag for RunPod registry
docker tag newsar/ollama:latest registry.runpod.io/yourusername/newsar-ollama:latest

# Login to RunPod registry
docker login registry.runpod.io
# Username: your RunPod email
# Password: your RunPod API key

# Push
docker push registry.runpod.io/yourusername/newsar-ollama:latest
```

---

## RunPod Configuration

### Step 1: Create RunPod Template

1. Log into [RunPod Dashboard](https://www.runpod.io/console/serverless)
2. Navigate to **Templates** → **New Template**
3. Fill in template details:

**Template Configuration:**

```
Template Name: Newsar Ollama (Pre-loaded)
Container Image: yourusername/newsar-ollama:latest
   (or: registry.runpod.io/yourusername/newsar-ollama:latest)

Container Disk: 20 GB (for models)

Expose HTTP Ports: 11434
Environment Variables:
  OLLAMA_HOST=0.0.0.0:11434
  OLLAMA_ORIGINS=*

Container Start Command: (leave blank, uses CMD from Dockerfile)
```

4. Click "Save Template"
5. **Copy the Template ID** (looks like: `abcd1234efgh5678`)
6. Note this ID for configuration step

### Step 2: Test Template Manually

Before automating, test the template:

1. Go to **Pods** → **Deploy**
2. Select your template: "Newsar Ollama (Pre-loaded)"
3. Choose GPU: **RTX 4090** or **A5000** (24GB VRAM)
4. Click **Deploy**
5. Wait 2-3 minutes for startup
6. Once "Running", click pod to get proxy URL (e.g., `https://xyz123-11434.proxy.runpod.net`)
7. Test the URL:

```bash
# Replace with your actual pod URL
POD_URL="https://xyz123-11434.proxy.runpod.net"

# Test Ollama
curl $POD_URL/api/tags

# Test models loaded
curl $POD_URL/api/generate -d '{
  "model": "qwen2.5:14b-instruct-q5_K_M",
  "prompt": "Hello",
  "stream": false
}'
```

8. If successful, **terminate the pod** (we'll use automation next)

---

## Deployment

### Step 1: Install RunPod SDK

```bash
cd /var/www/newsar.codejungle.org

# Add RunPod SDK
npm install runpod-sdk --save

# Also install types if available
npm install @types/node --save-dev
```

### Step 2: Configure Environment Variables

Add to ecosystem.config.cjs (or .env):

```javascript
// RunPod Configuration
RUNPOD_API_KEY: 'your-runpod-api-key-here',
RUNPOD_TEMPLATE_ID: 'your-template-id-here',
RUNPOD_GPU_TYPE: 'NVIDIA RTX 4090', // or 'NVIDIA A5000'
RUNPOD_POD_IDLE_TIMEOUT: '900000', // 15 minutes in milliseconds
RUNPOD_MAX_PODS: '1', // Safety limit
RUNPOD_MAX_COST_PER_DAY: '20', // $20/day USD limit
RUNPOD_ENABLED: 'true', // Feature flag

// Keep existing fallback
OLLAMA_FALLBACK_URL: 'http://localhost:11435',
OLLAMA_FALLBACK_CHAT_MODEL: 'llama3.2:3b',
OLLAMA_FALLBACK_EMBED_MODEL: 'nomic-embed-text',
```

### Step 3: Deploy Application

```bash
# Build the application with new RunPod code
npm run build

# Restart PM2 processes
pm2 restart newsar
pm2 restart newsar-worker
pm2 restart newsar-topic-worker

# Monitor logs
pm2 logs newsar --lines 50
```

### Step 4: Verify Automatic Pod Management

```bash
# Watch for pod creation
pm2 logs newsar | grep -i "runpod\|pod"

# Queue a test classification job to trigger pod creation
npm run test:classify 1

# Should see log output:
# [RunPod] No pod running, creating new pod...
# [RunPod] Pod created: pod-xyz123
# [RunPod] Waiting for pod to be ready...
# [RunPod] Pod ready after 2.3 minutes
# [Worker] Processing job classify-1...
```

---

## Monitoring & Operations

### Admin Dashboard

Navigate to: `http://localhost:3050/admin`

**RunPod Status Card shows:**
- Current pod status (Running/Stopped/Starting)
- Pod uptime
- Cost today / this month
- Time until idle timeout
- Manual controls (Start/Stop buttons)
- Savings vs always-on

### CLI Monitoring

```bash
# Check pod status via API
curl http://localhost:3050/api/admin/runpod/status

# Check cost analytics
curl http://localhost:3050/api/admin/runpod/cost

# View recent pod events
pm2 logs newsar | grep RunPod

# Monitor Redis for pod state
redis-cli get runpod:current_pod_id
redis-cli get runpod:last_activity
```

### Key Metrics to Track

1. **Cold Start Time:** Should be 2-3 minutes
2. **Idle Timeout:** Should terminate after 15 min idle
3. **Daily Cost:** Should be <$5/day (~$0.40/hr * 6 hrs active)
4. **Pod Creation Failures:** Should be <1% of attempts
5. **Job Failure Rate:** Should remain <3% (same as before)

---

## Troubleshooting

### Problem: Pod creation fails

**Symptoms:**
- Jobs stuck in queue
- Error logs: "Failed to create pod"

**Diagnosis:**
```bash
# Check RunPod API key
echo $RUNPOD_API_KEY

# Test API key manually
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://api.runpod.io/graphql \
  -d '{"query": "{ myself { id } }"}'

# Check template ID
echo $RUNPOD_TEMPLATE_ID
```

**Solutions:**
1. Verify API key is correct in ecosystem.config.cjs
2. Check RunPod account has available credits
3. Verify GPU type is available (try different region if needed)
4. Check template ID exists and is accessible
5. Review PM2 logs for detailed error messages

**Fallback:**
- System will automatically use local Ollama fallback
- Jobs will process slower but won't fail completely

### Problem: Pod doesn't terminate

**Symptoms:**
- Pod stays running >30 minutes after last job
- Cost exceeds expected daily amount

**Diagnosis:**
```bash
# Check idle monitor is running
pm2 logs newsar | grep "Idle Monitor"

# Check last activity timestamp
redis-cli get runpod:last_activity

# Check for stuck jobs
redis-cli llen bull:newsar-jobs:active
```

**Solutions:**
1. Manually terminate via admin dashboard
2. Check for jobs stuck in "active" state (blocking termination)
3. Restart idle monitor: `pm2 restart newsar`
4. Emergency: Terminate via RunPod dashboard directly

**Manual Termination:**
```bash
# Via API
curl -X POST http://localhost:3050/api/admin/runpod/terminate

# Via RunPod Dashboard
# 1. Log into RunPod
# 2. Go to Pods
# 3. Find the Newsar pod
# 4. Click "Terminate"
```

### Problem: Slow cold starts (>5 minutes)

**Symptoms:**
- First job of the day takes >5 minutes
- Logs show "Waiting for pod..." for extended time

**Diagnosis:**
```bash
# Check model pull times in Docker build
docker logs test-ollama 2>&1 | grep "Pulling"

# Test pod startup manually
# Deploy pod manually in RunPod dashboard
# Time how long until /api/tags responds

# Check pod region (closer = faster)
```

**Solutions:**
1. Verify Docker image has models pre-loaded (should see both in /api/tags instantly)
2. Rebuild Docker image if models weren't cached properly
3. Consider using RunPod's faster regions (US-West usually fastest)
4. Check network connectivity to RunPod

### Problem: Models not found on pod

**Symptoms:**
- Pod starts but returns "model not found" errors
- /api/tags shows empty model list

**Diagnosis:**
```bash
# SSH into running pod (if possible) or check logs
curl https://your-pod-url/api/tags

# Check Docker image was built correctly
docker run --rm newsar/ollama:latest ollama list
```

**Solutions:**
1. Rebuild Docker image ensuring models pull successfully
2. Increase Docker build timeout if models didn't finish downloading
3. Verify Ollama commands in Dockerfile ran successfully
4. Check RunPod template is using correct image tag

### Problem: Jobs fail during pod startup

**Symptoms:**
- First few jobs fail with timeout errors
- Workers report "Ollama not responding"

**Expected Behavior:**
- This is normal! First jobs may fail during 2-3 minute startup
- BullMQ will automatically retry (3 attempts)
- Jobs succeed once pod is ready

**Not an issue if:**
- Jobs succeed on retry within 5 minutes
- Success rate >97% overall

**Issue if:**
- Jobs fail even after pod shows "ready"
- Success rate <95%

**Solutions:**
1. Increase worker timeout for first request (currently 5 minutes)
2. Add longer job delay during pod startup
3. Check pod health status before marking as "ready"

---

## Cost Management

### Expected Costs

**GPU Pricing (approximate):**
- RTX 4090: $0.35-0.50/hour
- A5000: $0.40-0.55/hour

**Monthly Projections:**

| Usage Pattern | Hours/Day | Days/Month | Cost/Month |
|--------------|-----------|------------|------------|
| Light (news aggregator only) | 2-3 | 30 | $21-$45 |
| Normal (auto-pipeline) | 4-6 | 30 | $42-$90 |
| Heavy (manual processing) | 8-10 | 30 | $84-$165 |

**vs Always-On:** $252-360/month

### Cost Protection Features

1. **Daily Limit:** $20/day (configurable via `RUNPOD_MAX_COST_PER_DAY`)
2. **Max Pods:** 1 concurrent pod (prevents runaway costs)
3. **Idle Timeout:** Automatic termination after 15 minutes
4. **Alerts:** Email/log when approaching limits

### Monitoring Costs

```bash
# Check current month cost
curl http://localhost:3050/api/admin/runpod/cost?period=month

# Check today's cost
curl http://localhost:3050/api/admin/runpod/cost?period=today

# Get detailed breakdown
curl http://localhost:3050/api/admin/runpod/cost?period=week&detailed=true
```

### Cost Optimization Tips

1. **Schedule Peak Hours:** Use smart scheduling for predictable news cycles
2. **Batch Jobs:** Auto-pipeline already does this (25-50 jobs per batch)
3. **Monitor Idle Time:** If often <15 min between batches, reduce timeout
4. **GPU Selection:** A5000 sometimes cheaper than 4090, test both
5. **Region Selection:** Prices vary by region, compare in RunPod dashboard

### Budget Alerts

System will alert (via logs and admin dashboard) when:
- Daily cost exceeds 80% of limit ($16 of $20)
- Monthly cost exceeds projected budget
- Pod runs >2 hours continuously (potential stuck state)
- Multiple pod creation attempts (wasted startup costs)

---

## Emergency Procedures

### Emergency Shutdown (Cost Runaway)

**If pods are creating/running uncontrollably:**

```bash
# 1. Disable pod management immediately
# Edit ecosystem.config.cjs, set:
RUNPOD_ENABLED: 'false'

# 2. Restart application
pm2 restart newsar

# 3. Manually terminate all Newsar pods in RunPod dashboard
# Log into RunPod → Pods → Terminate all

# 4. Switch to local Ollama
# Ensure local Ollama is running:
ollama serve &

# 5. Verify fallback working
curl http://localhost:11435/api/tags

# 6. Investigate logs
pm2 logs newsar --lines 200 | grep -i "runpod\|error"

# 7. Fix issue before re-enabling
```

### Emergency Fallback to Local Ollama

**If RunPod unavailable or causing issues:**

```bash
# 1. Stop RunPod pod management
RUNPOD_ENABLED='false' pm2 restart newsar

# 2. Start local Ollama (on different port to avoid conflict)
OLLAMA_HOST=localhost:11435 ollama serve &

# 3. Verify local models
ollama list
# Should show: llama3.2:3b, nomic-embed-text

# 4. Pull missing models if needed
ollama pull llama3.2:3b
ollama pull nomic-embed-text

# 5. Test fallback
curl http://localhost:11435/api/tags

# System will now use local Ollama for all jobs
# Processing will be slower but functional
```

### Emergency Manual Pod Management

**If automation fails but you need RunPod:**

```bash
# 1. Disable automatic pod management
RUNPOD_ENABLED='false' pm2 restart newsar

# 2. Create pod manually in RunPod dashboard
# - Use your template
# - Note the pod URL

# 3. Update Ollama URL to use manual pod
# Edit ecosystem.config.cjs:
OLLAMA_BASE_URL: 'https://your-manual-pod-url-11434.proxy.runpod.net'

# 4. Restart
pm2 restart newsar

# 5. Pod will stay running until you manually terminate
# Remember to terminate when done to save costs!
```

### Rollback to Always-On Pod

**If on-demand system is problematic:**

```bash
# 1. Deploy permanent pod in RunPod
# - Use your template
# - Choose "Keep Running" option
# - Note the proxy URL

# 2. Disable on-demand features
# Edit ecosystem.config.cjs:
RUNPOD_ENABLED: 'false'
OLLAMA_BASE_URL: 'https://permanent-pod-url-11434.proxy.runpod.net'

# 3. Remove on-demand code (optional, can keep disabled)
# Or comment out imports in server/plugins/initPipeline.ts

# 4. Restart
npm run build
pm2 restart newsar

# 5. Verify working
curl $OLLAMA_BASE_URL/api/tags

# System now back to always-on model
# Cost: ~$252-360/month
```

---

## Maintenance

### Weekly Tasks

- [ ] Review cost analytics in admin dashboard
- [ ] Check pod creation success rate (should be >98%)
- [ ] Verify idle timeout working (no pods running >30 min idle)
- [ ] Review error logs for pod-related issues

### Monthly Tasks

- [ ] Update Docker image if Ollama releases new version
- [ ] Review and optimize idle timeout based on usage patterns
- [ ] Analyze cost vs always-on, verify savings
- [ ] Check for RunPod price changes or better GPU options
- [ ] Update RunPod API key if needed (keys can expire)

### Docker Image Updates

When Ollama or models need updating:

```bash
# 1. Rebuild image with latest Ollama
docker build -f Dockerfile.ollama -t newsar/ollama:v2 .

# 2. Test locally
docker run -d --name test-ollama-v2 -p 11434:11434 newsar/ollama:v2

# 3. Push to registry
docker push yourusername/newsar-ollama:v2

# 4. Update RunPod template to use :v2 tag

# 5. Test with manual pod deployment

# 6. Update RUNPOD_TEMPLATE_ID in config if needed

# 7. Deploy to production
pm2 restart newsar
```

---

## Support & Escalation

### Log Collection

When reporting issues:

```bash
# Collect comprehensive logs
pm2 logs newsar --lines 500 > newsar-logs.txt
pm2 logs newsar-worker --lines 500 >> newsar-logs.txt

# Get Redis state
redis-cli get runpod:current_pod_id >> newsar-logs.txt
redis-cli get runpod:last_activity >> newsar-logs.txt

# Get system status
curl http://localhost:3050/api/admin/runpod/status >> newsar-logs.txt
curl http://localhost:3050/api/admin/jobs/status >> newsar-logs.txt

# Include environment config (redact API keys!)
env | grep -E "OLLAMA|RUNPOD" >> newsar-logs.txt
```

### Contact Information

- **RunPod Support:** https://www.runpod.io/support
- **Ollama Issues:** https://github.com/ollama/ollama/issues
- **System Maintainer:** [Your contact info]

---

## Appendix: Configuration Reference

### Environment Variables

```bash
# RunPod API Configuration
RUNPOD_API_KEY=runpod-...           # API key from RunPod dashboard
RUNPOD_TEMPLATE_ID=abc123...        # Template ID from template creation
RUNPOD_GPU_TYPE=NVIDIA RTX 4090     # GPU type to request
RUNPOD_ENABLED=true                 # Enable/disable on-demand features

# Pod Lifecycle
RUNPOD_POD_IDLE_TIMEOUT=900000      # 15 min idle before termination (ms)
RUNPOD_POD_STARTUP_TIMEOUT=300000   # 5 min max startup time (ms)
RUNPOD_HEALTH_CHECK_INTERVAL=30000  # 30 sec between health checks (ms)

# Cost Protection
RUNPOD_MAX_PODS=1                   # Max concurrent pods
RUNPOD_MAX_COST_PER_DAY=20          # Daily cost limit (USD)
RUNPOD_MAX_COST_PER_MONTH=200       # Monthly cost limit (USD)

# Ollama Configuration (existing)
OLLAMA_BASE_URL=dynamic              # Will use RunPod pod URL dynamically
OLLAMA_CHAT_MODEL=qwen2.5:14b-instruct-q5_K_M
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_TIMEOUT=30000

# Fallback Configuration (existing)
OLLAMA_FALLBACK_URL=http://localhost:11435
OLLAMA_FALLBACK_CHAT_MODEL=llama3.2:3b
OLLAMA_FALLBACK_EMBED_MODEL=nomic-embed-text
```

### RunPod API Endpoints Used

```
POST   /graphql - Create/manage pods
GET    /graphql - Query pod status
DELETE /graphql - Terminate pods
```

### Pod Lifecycle States

```
PENDING   → Pod creation requested, waiting for RunPod
STARTING  → Pod allocated, initializing Ollama
READY     → Ollama responding, models available
ACTIVE    → Processing jobs
IDLE      → No jobs, timeout counting down
TERMINATING → Shutdown initiated
TERMINATED → Pod destroyed
```

---

**Document Version:** 1.0
**Last Updated:** 2025-10-30
**System:** Newsar v1.0 On-Demand RunPod Integration
