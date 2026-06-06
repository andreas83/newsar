/**
 * Test RunPod API to debug 400 errors
 */

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || ''
const TEMPLATE_ID = process.env.RUNPOD_TEMPLATE_ID || 'zimt6oxa13'
const GPU_TYPE = process.env.RUNPOD_GPU_TYPE || 'NVIDIA RTX A4000'

async function testAPI() {
  console.log('Testing RunPod API...\n')
  console.log('Config:')
  console.log(`  API Key: ${RUNPOD_API_KEY.slice(0, 10)}...${RUNPOD_API_KEY.slice(-5)}`)
  console.log(`  Template ID: ${TEMPLATE_ID}`)
  console.log(`  GPU Type: ${GPU_TYPE}`)
  console.log('')

  // Test 1: List all pods
  console.log('Test 1: List all pods')
  try {
    const listQuery = `
      query {
        myself {
          pods {
            id
            name
            desiredStatus
            machine {
              gpuDisplayName
            }
          }
        }
      }
    `

    const response = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({ query: listQuery }),
    })

    const data = await response.json()

    if (data.errors) {
      console.error('  ❌ Error:', JSON.stringify(data.errors, null, 2))
    } else {
      console.log('  ✓ Success!')
      console.log('  Pods:', JSON.stringify(data.data?.myself?.pods || [], null, 2))
    }
  } catch (error) {
    console.error('  ❌ Error:', error)
  }

  console.log('')

  // Test 2: Get pod templates
  console.log('Test 2: Get available templates')
  try {
    const templatesQuery = `
      query {
        myself {
          serverTemplates {
            id
            name
            imageName
          }
        }
      }
    `

    const response = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({ query: templatesQuery }),
    })

    const data = await response.json()

    if (data.errors) {
      console.error('  ❌ Error:', JSON.stringify(data.errors, null, 2))
    } else {
      console.log('  ✓ Success!')
      const templates = data.data?.myself?.serverTemplates || []
      console.log('  Templates:')
      templates.forEach((t: any) => {
        console.log(`    - ${t.id}: ${t.name} (${t.imageName})`)
      })

      // Check if our template exists
      const ourTemplate = templates.find((t: any) => t.id === TEMPLATE_ID)
      if (ourTemplate) {
        console.log(`\n  ✓ Template ${TEMPLATE_ID} found: ${ourTemplate.name}`)
      } else {
        console.log(`\n  ❌ Template ${TEMPLATE_ID} NOT FOUND!`)
      }
    }
  } catch (error) {
    console.error('  ❌ Error:', error)
  }

  console.log('')

  // Test 3: Get GPU types
  console.log('Test 3: Get available GPU types')
  try {
    const gpuQuery = `
      query {
        gpuTypes {
          id
          displayName
          memoryInGb
        }
      }
    `

    const response = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({ query: gpuQuery }),
    })

    const data = await response.json()

    if (data.errors) {
      console.error('  ❌ Error:', JSON.stringify(data.errors, null, 2))
    } else {
      console.log('  ✓ Success!')
      const gpuTypes = data.data?.gpuTypes || []
      console.log('  GPU Types:')
      gpuTypes.slice(0, 20).forEach((g: any) => {
        console.log(`    - ${g.id}: ${g.displayName} (${g.memoryInGb}GB)`)
      })

      // Check if our GPU type exists
      const ourGPU = gpuTypes.find((g: any) => g.id === GPU_TYPE || g.displayName === GPU_TYPE)
      if (ourGPU) {
        console.log(`\n  ✓ GPU type "${GPU_TYPE}" found: ${ourGPU.displayName} (ID: ${ourGPU.id})`)
      } else {
        console.log(`\n  ⚠️  GPU type "${GPU_TYPE}" not found by exact match`)
        console.log(`  Searching for similar matches...`)
        const similarGPUs = gpuTypes.filter((g: any) =>
          g.displayName.toLowerCase().includes('a4000') ||
          g.displayName.toLowerCase().includes('4090')
        )
        if (similarGPUs.length > 0) {
          console.log('  Similar GPUs:')
          similarGPUs.forEach((g: any) => {
            console.log(`    - ${g.id}: ${g.displayName}`)
          })
        }
      }
    }
  } catch (error) {
    console.error('  ❌ Error:', error)
  }
}

testAPI()
