import { getDatabase } from '~/server/database/db'
import { articles, storyMembers, stories } from '~/server/database/schema'
import { eq, sql, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const body = await readBody(event)

  const articleIds: number[] = Array.isArray(body.ids) ? body.ids : [body.id]
  const exclude = body.exclude !== false // default true

  if (!articleIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Article ID(s) required' })
  }

  try {
    // Mark articles as excluded
    await db
      .update(articles)
      .set({ excluded: exclude })
      .where(inArray(articles.id, articleIds))

    // Remove excluded articles from stories and update story counts
    if (exclude) {
      // Find affected stories before removing members
      const affectedMembers = await db
        .select({ storyId: storyMembers.storyId })
        .from(storyMembers)
        .where(inArray(storyMembers.articleId, articleIds))

      const affectedStoryIds = [...new Set(affectedMembers.map(m => m.storyId))]

      // Remove from story_members
      await db
        .delete(storyMembers)
        .where(inArray(storyMembers.articleId, articleIds))

      // Clear story_id FK on the articles
      await db
        .update(articles)
        .set({ storyId: null })
        .where(inArray(articles.id, articleIds))

      // Update article counts for affected stories
      for (const storyId of affectedStoryIds) {
        const [count] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(storyMembers)
          .where(eq(storyMembers.storyId, storyId))

        const newCount = Number(count?.count) || 0

        if (newCount === 0) {
          // Delete empty stories
          await db.delete(stories).where(eq(stories.id, storyId))
        } else {
          await db
            .update(stories)
            .set({ articleCount: newCount })
            .where(eq(stories.id, storyId))
        }
      }
    }

    return {
      success: true,
      excluded: exclude,
      articleIds,
    }
  } catch (error) {
    console.error('Error excluding articles:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to exclude articles' })
  }
})
