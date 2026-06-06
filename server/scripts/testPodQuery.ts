/**
 * Test different pod query formats to find the correct one
 */

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || ''

async function testQuery(name: string, query: string, variables?: any) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Test: ${name}`)
  console.log(`${'='.repeat(60)}`)

  try {
    const response = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({ query, variables }),
    })

    const data = await response.json()

    if (data.errors) {
      console.error('❌ GraphQL Errors:')
      console.error(JSON.stringify(data.errors, null, 2))
    } else {
      console.log('✓ Success!')
      console.log(JSON.stringify(data.data, null, 2))
    }
  } catch (error) {
    console.error('❌ Network Error:', error)
  }
}

async function main() {
  // Test 1: Current format (might be wrong)
  await testQuery(
    'Current format: pod(input: { podId })',
    `
      query GetPod($podId: String!) {
        pod(input: { podId: $podId }) {
          id
          desiredStatus
        }
      }
    `,
    { podId: 'test123' }
  )

  // Test 2: Direct pod query
  await testQuery(
    'Direct pod query: pod(id)',
    `
      query GetPod($podId: String!) {
        pod(id: $podId) {
          id
          desiredStatus
        }
      }
    `,
    { podId: 'test123' }
  )

  // Test 3: Get schema info
  await testQuery(
    'Schema introspection for pod type',
    `
      {
        __type(name: "Query") {
          fields {
            name
            args {
              name
              type {
                name
                kind
              }
            }
          }
        }
      }
    `
  )

  // Test 4: List pods (we know this works)
  await testQuery(
    'List pods via myself.pods',
    `
      query {
        myself {
          pods {
            id
            name
            desiredStatus
            runtime {
              uptimeInSeconds
            }
          }
        }
      }
    `
  )
}

main()
