/**
 * One-time migration: convert existing article images to resized WebP.
 *
 * For every article whose image_local_path is not already .webp/.svg:
 *   1. Convert the file to WebP (max 1200px wide, quality 80)
 *   2. Update articles.image_local_path
 *   3. Delete the original file (only after 1+2 succeeded)
 *
 * Resumable: already-converted rows are excluded by the query.
 *
 * Run with: npx tsx server/scripts/convertImagesToWebp.ts [limit] [concurrency] [--dry-run]
 */

import { config } from 'dotenv'
import sharp from 'sharp'
import { access, stat, unlink } from 'fs/promises'
import { join, basename } from 'path'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../database/db'
import { articles } from '../database/schema'

config()

const WEBP_MAX_WIDTH = 1200
const WEBP_QUALITY = 80
const IMAGES_DIR = join(process.cwd(), 'storage', 'images', 'articles')

interface Stats {
  converted: number
  skippedMissing: number
  failed: number
  bytesBefore: number
  bytesAfter: number
}

async function convertOne(
  row: { id: number; imageLocalPath: string },
  dryRun: boolean,
  stats: Stats,
): Promise<void> {
  const filename = basename(row.imageLocalPath)
  const srcPath = join(IMAGES_DIR, filename)

  try {
    await access(srcPath)
  } catch {
    stats.skippedMissing++
    return
  }

  const isGif = /\.gif$/i.test(filename)
  const newFilename = filename.replace(/\.[a-zA-Z0-9]{2,4}$/, '') + '.webp'
  const destPath = join(IMAGES_DIR, newFilename)

  try {
    const sizeBefore = (await stat(srcPath)).size

    if (dryRun) {
      console.log(`[dry-run] would convert ${filename} -> ${newFilename}`)
      stats.converted++
      return
    }

    await sharp(srcPath, { animated: isGif })
      .resize({ width: WEBP_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(destPath)

    const db = getDatabase()
    await db
      .update(articles)
      .set({ imageLocalPath: `/images/articles/${newFilename}` })
      .where(eq(articles.id, row.id))

    // Original is only removed once the WebP exists and the DB points at it
    if (srcPath !== destPath) {
      await unlink(srcPath)
    }

    const sizeAfter = (await stat(destPath)).size
    stats.bytesBefore += sizeBefore
    stats.bytesAfter += sizeAfter
    stats.converted++
  } catch (error: any) {
    stats.failed++
    console.error(`Failed to convert ${filename}: ${error.message}`)
    // Clean up a partial .webp so a retry starts fresh
    try {
      await unlink(destPath)
    } catch {}
  }
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--dry-run')
  const dryRun = process.argv.includes('--dry-run')
  const limit = parseInt(args[0]) || 0 // 0 = no limit
  const concurrency = parseInt(args[1]) || 4

  const db = getDatabase()

  const rows = (
    await db
      .select({ id: articles.id, imageLocalPath: articles.imageLocalPath })
      .from(articles)
  ).filter(
    (r): r is { id: number; imageLocalPath: string } =>
      !!r.imageLocalPath && !/\.(webp|svg)$/i.test(r.imageLocalPath),
  )

  const queue = limit > 0 ? rows.slice(0, limit) : rows
  console.log(`\n🖼  Converting ${queue.length} images to WebP (concurrency: ${concurrency}${dryRun ? ', DRY RUN' : ''})\n`)

  const stats: Stats = { converted: 0, skippedMissing: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 }
  let cursor = 0

  async function worker() {
    while (cursor < queue.length) {
      const row = queue[cursor++]
      await convertOne(row, dryRun, stats)

      const done = stats.converted + stats.skippedMissing + stats.failed
      if (done % 500 === 0) {
        const savedMb = ((stats.bytesBefore - stats.bytesAfter) / 1024 / 1024).toFixed(0)
        console.log(`Progress: ${done}/${queue.length} (saved ${savedMb} MB so far)`)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const savedMb = ((stats.bytesBefore - stats.bytesAfter) / 1024 / 1024).toFixed(0)
  console.log(`\n✅ Done: ${stats.converted} converted, ${stats.skippedMissing} missing on disk, ${stats.failed} failed`)
  console.log(`💾 Disk saved: ${savedMb} MB (${(stats.bytesBefore / 1024 / 1024 / 1024).toFixed(2)} GB -> ${(stats.bytesAfter / 1024 / 1024 / 1024).toFixed(2)} GB)`)

  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
