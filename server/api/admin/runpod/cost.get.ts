/**
 * Get RunPod cost analytics
 * Returns cost breakdown by period (today, week, month)
 */

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const period = (query.period as string) || 'today'

    // Check if RunPod is enabled
    const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

    if (!runpodEnabled) {
      return {
        enabled: false,
        message: 'RunPod on-demand management is disabled',
      }
    }

    // Get manager instance
    const { getRunPodManager } = await import('../../../services/runpodManager')
    const manager = getRunPodManager()

    if (!manager) {
      return {
        enabled: false,
        error: 'RunPod manager not initialized',
      }
    }

    // Get daily cost
    const dailyCost = await manager.getDailyCost()

    // Calculate cost from current session if pod is running
    const currentPod = manager.getCurrentPod()
    let currentSessionCost = 0

    if (currentPod && (currentPod.status === 'READY' || currentPod.status === 'ACTIVE' || currentPod.status === 'IDLE')) {
      const uptimeHours = (Date.now() - currentPod.createdAt) / (1000 * 60 * 60)
      currentSessionCost = uptimeHours * 0.40 // $0.40/hr
    }

    // Get cost limit
    const config = await manager.getStatus()
    const maxCostPerDay = config.maxCostPerDay || 20

    // Calculate period costs
    let periodCost = dailyCost
    let periodLabel = 'Today'
    let periodDetails = null

    switch (period) {
      case 'today':
        periodCost = dailyCost
        periodLabel = 'Today'
        periodDetails = {
          date: new Date().toISOString().split('T')[0],
          accumulated: dailyCost.toFixed(2),
          currentSession: currentSessionCost.toFixed(2),
          total: (dailyCost + currentSessionCost).toFixed(2),
        }
        break

      case 'week':
        // For week, we'd need to store historical data
        // For now, just show today's cost
        periodCost = dailyCost
        periodLabel = 'This Week (estimated)'
        periodDetails = {
          note: 'Historical data not yet implemented',
          todayCost: dailyCost.toFixed(2),
          estimatedWeek: (dailyCost * 7).toFixed(2),
        }
        break

      case 'month':
        // For month, estimate based on daily average
        periodCost = dailyCost
        periodLabel = 'This Month (estimated)'
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
        periodDetails = {
          note: 'Historical data not yet implemented',
          todayCost: dailyCost.toFixed(2),
          estimatedMonth: (dailyCost * daysInMonth).toFixed(2),
        }
        break
    }

    // Calculate savings vs always-on
    const alwaysOnCostPerDay = 0.40 * 24 // $0.40/hr * 24 hrs
    const alwaysOnCostPerMonth = alwaysOnCostPerDay * 30

    const actualDailyCost = dailyCost + currentSessionCost
    const savingsToday = alwaysOnCostPerDay - actualDailyCost
    const savingsPercent = (savingsToday / alwaysOnCostPerDay) * 100

    return {
      enabled: true,
      period: periodLabel,
      cost: {
        current: periodCost.toFixed(2),
        currentSession: currentSessionCost.toFixed(2),
        total: (periodCost + currentSessionCost).toFixed(2),
        limit: maxCostPerDay.toFixed(2),
        percentage: ((periodCost + currentSessionCost) / maxCostPerDay * 100).toFixed(1),
      },
      savings: {
        vsAlwaysOn: {
          today: savingsToday.toFixed(2),
          percentage: savingsPercent.toFixed(1),
          alwaysOnCost: alwaysOnCostPerDay.toFixed(2),
        },
        projected: {
          month: ((alwaysOnCostPerMonth - (actualDailyCost * 30))).toFixed(2),
          year: ((alwaysOnCostPerMonth * 12) - (actualDailyCost * 365)).toFixed(2),
        },
      },
      breakdown: periodDetails,
      currentPod: currentPod ? {
        id: currentPod.id,
        status: currentPod.status,
        uptimeHours: ((Date.now() - currentPod.createdAt) / (1000 * 60 * 60)).toFixed(2),
        sessionCost: currentSessionCost.toFixed(2),
        jobsProcessed: currentPod.jobsProcessed,
        costPerJob: currentPod.jobsProcessed > 0 ? (currentSessionCost / currentPod.jobsProcessed).toFixed(3) : '0.000',
      } : null,
    }
  } catch (error) {
    console.error('[API] Failed to get RunPod cost:', error)
    return {
      enabled: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
})
