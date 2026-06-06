/**
 * Queue all pending processing jobs for the full pipeline
 *
 * Run with: npx tsx server/scripts/queueFullPipeline.ts
 */

import { config } from 'dotenv'
import {
  queuePendingExtractions,
  queuePendingImageExtractions,
  queuePendingClassifications,
  queuePendingEmbeddings,
  queuePendingAnalyses
} from '../queues/feedQueue'

// Load environment variables
config()

async function main() {
  try {
    console.log('\n🚀 Queuing full processing pipeline...\n')

    // Step 1: Content extraction (highest priority)
    console.log('1️⃣ Queuing content extractions...')
    const extractJobs = await queuePendingExtractions(100)
    console.log(`   ✅ Queued ${extractJobs.length} content extraction jobs\n`)

    // Step 2: Image extraction (medium-low priority)
    console.log('2️⃣ Queuing image extractions...')
    const imageJobs = await queuePendingImageExtractions(100)
    console.log(`   ✅ Queued ${imageJobs.length} image extraction jobs\n`)

    // Step 3: Classification (medium priority)
    console.log('3️⃣ Queuing classifications...')
    const classifyJobs = await queuePendingClassifications(50)
    console.log(`   ✅ Queued ${classifyJobs.length} classification jobs\n`)

    // Step 4: Analysis (medium priority)
    console.log('4️⃣ Queuing analyses...')
    const analysisJobs = await queuePendingAnalyses(30)
    console.log(`   ✅ Queued ${analysisJobs.length} analysis jobs\n`)

    // Step 5: Embeddings (lowest priority, most resource intensive)
    console.log('5️⃣ Queuing embeddings...')
    const embedJobs = await queuePendingEmbeddings(20)
    console.log(`   ✅ Queued ${embedJobs.length} embedding jobs\n`)

    const totalJobs = extractJobs.length + imageJobs.length + classifyJobs.length +
                      analysisJobs.length + embedJobs.length

    console.log(`\n✅ Successfully queued ${totalJobs} jobs across the full pipeline`)
    console.log('\n💡 Worker will process them automatically with concurrency=1')
    console.log('   Priority order: content → images → classification → analysis → embeddings\n')

    process.exit(0)
  } catch (error) {
    console.error('\n❌ Failed to queue pipeline jobs:', error)
    process.exit(1)
  }
}

main()
