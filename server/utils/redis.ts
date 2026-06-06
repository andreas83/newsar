import Redis from 'ioredis'

let redisClient: Redis | null = null

export function getRedisClient(): Redis {
  if (!redisClient) {
    const config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Required for BullMQ
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
    }

    redisClient = new Redis(config)

    redisClient.on('error', (err) => {
      console.error('Redis connection error:', err)
    })

    redisClient.on('connect', () => {
      console.log('Redis connected successfully')
    })
  }

  return redisClient
}

export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
  }
}
