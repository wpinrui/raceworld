import Anthropic from '@anthropic-ai/sdk'

// Newsroom LLM client. Server-only — only imported by the 'use server' actions, so the
// API key never reaches the client bundle.

export const NEWSROOM_MODEL = 'claude-sonnet-4-6'
export const MAX_TOOL_ITERATIONS = 8
export const MAX_TOKENS = 1500

let client: Anthropic | null = null

export function hasApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

// Returns null when no key is configured, so callers can degrade gracefully.
export function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}
