import { appendFile } from 'fs/promises'
import { join } from 'path'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const { name, subject, message } = body || {}

  if (!name || !subject || !message) {
    throw createError({ statusCode: 400, message: 'Name, subject, and message are required.' })
  }

  if (name.length > 200 || subject.length > 200 || message.length > 5000) {
    throw createError({ statusCode: 400, message: 'Input too long.' })
  }

  const timestamp = new Date().toISOString()
  const ip = getRequestHeader(event, 'x-forwarded-for') || getRequestHeader(event, 'x-real-ip') || 'unknown'

  const entry = [
    `--- Contact Message [${timestamp}] ---`,
    `IP: ${ip}`,
    `Name: ${name.trim()}`,
    `Subject: ${subject.trim()}`,
    `Message:`,
    message.trim(),
    `--- End ---`,
    '',
    '',
  ].join('\n')

  const logPath = join(process.cwd(), 'data', 'contact.log')

  try {
    await appendFile(logPath, entry, 'utf-8')
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // Create data directory if it doesn't exist
      const { mkdir } = await import('fs/promises')
      await mkdir(join(process.cwd(), 'data'), { recursive: true })
      await appendFile(logPath, entry, 'utf-8')
    } else {
      throw createError({ statusCode: 500, message: 'Failed to save message.' })
    }
  }

  return { success: true }
})
