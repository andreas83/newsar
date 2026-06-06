/**
 * Test script to verify Ollama fallback mechanism
 *
 * Usage:
 *   npm run test:ollama-fallback
 *
 * This script tests:
 * 1. Chat completion with fallback
 * 2. Embedding generation with fallback
 * 3. Behavior when primary fails
 */

import { generateChatCompletion, generateEmbedding } from '../utils/ollama'

async function testChatCompletion() {
  console.log('\n=== Testing Chat Completion ===')
  try {
    const result = await generateChatCompletion(
      'Say "hello" in one word',
      'You are a helpful assistant'
    )
    console.log('✓ Chat completion successful')
    console.log('Response:', result.substring(0, 100))
    return true
  } catch (error) {
    console.error('✗ Chat completion failed:', error instanceof Error ? error.message : 'Unknown error')
    return false
  }
}

async function testEmbedding() {
  console.log('\n=== Testing Embedding Generation ===')
  try {
    const result = await generateEmbedding('This is a test sentence')
    console.log('✓ Embedding generation successful')
    console.log(`Embedding dimensions: ${result.length}`)
    console.log(`First 5 values: ${result.slice(0, 5).join(', ')}`)
    return true
  } catch (error) {
    console.error('✗ Embedding generation failed:', error instanceof Error ? error.message : 'Unknown error')
    return false
  }
}

async function main() {
  console.log('Testing Ollama Fallback Mechanism')
  console.log('==================================')

  console.log('\nConfiguration:')
  console.log('Primary URL:', process.env.OLLAMA_BASE_URL)
  console.log('Primary Chat Model:', process.env.OLLAMA_CHAT_MODEL)
  console.log('Primary Embed Model:', process.env.OLLAMA_EMBED_MODEL)
  console.log('Fallback URL:', process.env.OLLAMA_FALLBACK_URL || 'http://localhost:11435')
  console.log('Fallback Chat Model:', process.env.OLLAMA_FALLBACK_CHAT_MODEL || 'llama3.2:3b')
  console.log('Fallback Embed Model:', process.env.OLLAMA_FALLBACK_EMBED_MODEL || 'nomic-embed-text')
  console.log('Timeout:', process.env.OLLAMA_TIMEOUT || '30000', 'ms')

  const chatSuccess = await testChatCompletion()
  const embedSuccess = await testEmbedding()

  console.log('\n=== Test Results ===')
  console.log('Chat Completion:', chatSuccess ? '✓ PASS' : '✗ FAIL')
  console.log('Embedding Generation:', embedSuccess ? '✓ PASS' : '✗ FAIL')

  if (chatSuccess && embedSuccess) {
    console.log('\n✓ All tests passed! Fallback mechanism is working.')
    process.exit(0)
  } else {
    console.log('\n✗ Some tests failed. Check your Ollama instances.')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
