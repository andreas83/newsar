/**
 * Automatic Job Pipeline Manager
 * Monitors pipeline status and automatically queues jobs based on system load and article state
 */

import { getDatabase } from '../database/db'
import { articles, feeds, classifications, articleEmbeddings, analyses } from '../database/schema'
import { eq, isNull, lt, and, sql, notInArray } from 'drizzle-orm'
import {
  queueAllActiveFeeds,
  queuePendingExtractions,
  queuePendingImageExtractions,
  queuePendingClassifications,
  queuePendingEmbeddings,
  queuePendingAnalyses,
} from '../queues/feedQueue'
import os from 'node:os'

interface PipelineConfig {
  maxConcurrentJobs: number
  checkIntervalMinutes: number
  batchSizes: {
    extraction: number
    images: number
    classification: number
    embeddings: number
    analysis: number
  }
  loadThresholds: {
    cpu: number // Max CPU usage (0-1)
    memory: number // Max memory usage (0-1)
  }
}

const defaultConfig: PipelineConfig = {
  maxConcurrentJobs: 10,
  checkIntervalMinutes: 5,
  batchSizes: {
    extraction: 50,
    images: 30,
    classification: 5, // Small batches - NER is CPU-intensive
    embeddings: 10,
    analysis: 2, // Very small - Summaries use ~900% CPU each
  },
  loadThresholds: {
    cpu: 0.8, // 80% CPU threshold
    memory: 0.75, // 75% memory
  },
}

export class AutoPipeline {
  private config: PipelineConfig
  private isRunning = false
  private intervalId: NodeJS.Timeout | null = null

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...defaultConfig, ...config }
  }

  /**
   * Get CPU temperature (Linux only)
   */
  private getCPUTemperature(): number | null {
    try {
      // Try to read CPU temperature from thermal zone (Linux)
      const fs = require('fs')
      const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')
      return parseInt(temp.trim()) / 1000 // Convert from millidegrees to degrees
    } catch (error) {
      // Temperature monitoring not available or not on Linux
      return null
    }
  }

  /**
   * Get current system load
   */
  private getSystemLoad() {
    const cpus = os.cpus()
    const avgLoad = os.loadavg()[0] // 1 minute average
    const cpuCount = cpus.length
    const cpuUsage = avgLoad / cpuCount // Normalized 0-1

    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const memoryUsage = (totalMem - freeMem) / totalMem

    // Check CPU temperature
    const cpuTemp = this.getCPUTemperature()
    const isTooHot = cpuTemp !== null && cpuTemp > 75 // Above 75°C is concerning

    return {
      cpu: cpuUsage,
      memory: memoryUsage,
      temperature: cpuTemp,
      isOverloaded: cpuUsage > this.config.loadThresholds.cpu ||
                     memoryUsage > this.config.loadThresholds.memory ||
                     isTooHot,
      isTooHot,
    }
  }

  /**
   * Get pipeline statistics
   */
  private async getPipelineStats() {
    const db = getDatabase()

    // Count articles needing each processing step
    const stats = {
      needsExtraction: await db
        .select({ count: sql<number>`count(*)` })
        .from(articles)
        .where(and(
          isNull(articles.fullContent),
          eq(articles.extractionStatus, 'pending')
        ))
        .then(r => Number(r[0]?.count || 0)),

      needsImages: await db
        .select({ count: sql<number>`count(*)` })
        .from(articles)
        .where(and(
          isNull(articles.imageLocalPath),
          eq(articles.imageFetchStatus, 'pending')
        ))
        .then(r => Number(r[0]?.count || 0)),

      needsClassification: await db
        .select({ count: sql<number>`count(*)` })
        .from(articles)
        .where(
          sql`${articles.id} NOT IN (SELECT article_id FROM classifications)`
        )
        .then(r => Number(r[0]?.count || 0)),

      needsEmbeddings: await db
        .select({ count: sql<number>`count(*)` })
        .from(articles)
        .where(
          sql`${articles.id} NOT IN (SELECT article_id FROM article_embeddings)`
        )
        .then(r => Number(r[0]?.count || 0)),

      needsAnalysis: await db
        .select({ count: sql<number>`count(*)` })
        .from(articles)
        .where(
          sql`${articles.id} NOT IN (SELECT article_id FROM analyses)`
        )
        .then(r => Number(r[0]?.count || 0)),
    }

    return stats
  }

  /**
   * Execute pipeline cycle
   */
  private async executeCycle() {
    if (this.isRunning) {
      console.log('[AutoPipeline] Cycle already running, skipping...')
      return
    }

    this.isRunning = true

    try {
      // Check system load (critical now that we use CPU-based Transformers.js)
      const load = this.getSystemLoad()
      const tempInfo = load.temperature !== null ? ` | Temp: ${load.temperature.toFixed(1)}°C` : ''
      console.log('[AutoPipeline] System load:', {
        cpu: `${(load.cpu * 100).toFixed(1)}%`,
        memory: `${(load.memory * 100).toFixed(1)}%`,
        temperature: load.temperature !== null ? `${load.temperature.toFixed(1)}°C` : 'N/A',
        cpuThreshold: `${(this.config.loadThresholds.cpu * 100).toFixed(0)}%`,
        memoryThreshold: `${(this.config.loadThresholds.memory * 100).toFixed(0)}%`,
        tempThreshold: '75°C',
      })

      if (load.isOverloaded) {
        console.log('[AutoPipeline] ⚠️  System overloaded, skipping cycle to prevent overheating')
        console.log('[AutoPipeline] CPU:', `${(load.cpu * 100).toFixed(1)}% (threshold: ${(this.config.loadThresholds.cpu * 100).toFixed(0)}%)`)
        console.log('[AutoPipeline] Memory:', `${(load.memory * 100).toFixed(1)}% (threshold: ${(this.config.loadThresholds.memory * 100).toFixed(0)}%)`)
        if (load.isTooHot && load.temperature !== null) {
          console.log('[AutoPipeline] 🔥 Temperature:', `${load.temperature.toFixed(1)}°C (threshold: 75°C)`)
        }
        return
      }

      // Get pipeline stats
      const stats = await this.getPipelineStats()
      console.log('[AutoPipeline] Pipeline stats:', stats)

      const jobsQueued: string[] = []

      // Queue extraction jobs (highest priority)
      if (stats.needsExtraction > 0) {
        const count = Math.min(stats.needsExtraction, this.config.batchSizes.extraction)
        await queuePendingExtractions(count)
        jobsQueued.push(`${count} content extractions`)
      }

      // Queue image extraction
      if (stats.needsImages > 0) {
        const count = Math.min(stats.needsImages, this.config.batchSizes.images)
        await queuePendingImageExtractions(count)
        jobsQueued.push(`${count} image extractions`)
      }

      // Queue classification (after extraction)
      if (stats.needsClassification > 0) {
        const count = Math.min(stats.needsClassification, this.config.batchSizes.classification)
        await queuePendingClassifications(count)
        jobsQueued.push(`${count} classifications`)
      }

      // Queue embeddings (after classification)
      if (stats.needsEmbeddings > 0) {
        const count = Math.min(stats.needsEmbeddings, this.config.batchSizes.embeddings)
        await queuePendingEmbeddings(count)
        jobsQueued.push(`${count} embeddings`)
      }

      // Queue analysis (after classification)
      if (stats.needsAnalysis > 0) {
        const count = Math.min(stats.needsAnalysis, this.config.batchSizes.analysis)
        await queuePendingAnalyses(count)
        jobsQueued.push(`${count} analyses`)
      }

      if (jobsQueued.length > 0) {
        console.log(`[AutoPipeline] Queued: ${jobsQueued.join(', ')}`)
      } else {
        console.log('[AutoPipeline] No jobs to queue')
      }
    } catch (error) {
      console.error('[AutoPipeline] Error during cycle:', error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Start automatic pipeline
   */
  start() {
    if (this.intervalId) {
      console.log('[AutoPipeline] Already running')
      return
    }

    console.log(`[AutoPipeline] Starting with ${this.config.checkIntervalMinutes}min interval`)

    // Run immediately
    this.executeCycle()

    // Then run on interval
    this.intervalId = setInterval(
      () => this.executeCycle(),
      this.config.checkIntervalMinutes * 60 * 1000
    )
  }

  /**
   * Stop automatic pipeline
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[AutoPipeline] Stopped')
    }
  }

  /**
   * Get current status
   */
  async getStatus() {
    const stats = await this.getPipelineStats()
    const load = this.getSystemLoad()

    return {
      running: !!this.intervalId,
      stats,
      config: this.config,
      systemLoad: {
        cpu: load.cpu,
        cpuPercent: `${(load.cpu * 100).toFixed(1)}%`,
        memory: load.memory,
        memoryPercent: `${(load.memory * 100).toFixed(1)}%`,
        temperature: load.temperature,
        temperatureC: load.temperature !== null ? `${load.temperature.toFixed(1)}°C` : null,
        isOverloaded: load.isOverloaded,
        isTooHot: load.isTooHot,
      },
    }
  }
}

// Singleton instance
let autoPipelineInstance: AutoPipeline | null = null

export function getAutoPipeline(): AutoPipeline {
  if (!autoPipelineInstance) {
    autoPipelineInstance = new AutoPipeline()
  }
  return autoPipelineInstance
}
