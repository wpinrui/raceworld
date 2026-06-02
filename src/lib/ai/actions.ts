'use server'

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasApiKey, NEWSROOM_MODEL, MAX_TOOL_ITERATIONS, MAX_TOKENS } from './client'
import { NEWSROOM_TOOLS, executeTool } from './tools'
import { getRaceReview, listRaceReviews, upsertNewsArticle, getSeasonIdByYear, type DbNewsArticle } from '@/lib/db/queries'
import type { RaceReview, NewsroomResult, NewsroomSearchResult } from './types'

const RACE_REVIEW_SYSTEM = `You are a motorsport journalist covering an alternate-reality Formula 1 world. This world has its OWN drivers, teams, and history — there is no real-world F1; only the data returned by your tools exists.

Hard rules:
- Every factual claim (positions, gaps, points, records, championship state) MUST come from a tool result. Never invent drivers, teams, lap times, or records.
- If a tool returns no data, omit that angle rather than guessing.
- Write in a concise sports-journalism voice. Body ~150-300 words, plain paragraphs, no markdown headings.

To write a race review, first call get_race_classification and get_race_feats for the given race, and get_season_standings for championship context. Only dig into a driver's career/honours if a feat makes them newsworthy. Then write the report as plain prose.`

const SEARCH_SYSTEM = `You are the newsroom desk for an alternate-reality Formula 1 world. This world has its OWN drivers, teams, and history — there is no real-world F1; only the data returned by your tools exists.

Answer the player's query as a short, factual news piece grounded in the tools:
- Call search_index first to resolve any driver or team name into the id the other tools need.
- Treat the player's premise as true unless a tool result directly contradicts it; if it is contradicted, gently correct it using the stats.
- Every factual claim MUST come from a tool result. Never invent drivers, teams, numbers, or records. If the data isn't there, say so plainly.
- Keep it concise (a few short paragraphs), in a sports-journalism voice.`

const STRUCTURE_SYSTEM = `You turn a drafted race report into structured fields. Preserve the wording and facts of the draft; do not add new claims.`

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Punchy headline, <= 12 words' },
    dek: { type: 'string', description: 'One-sentence standfirst summarising the race' },
    body: { type: 'string', description: 'The full report in plain paragraphs' },
  },
  required: ['headline', 'dek', 'body'],
  additionalProperties: false,
} as const

function textOf(resp: Anthropic.Message): string {
  return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim()
}

function toReview(a: DbNewsArticle): RaceReview {
  return { year: a.year, round: a.round ?? 0, headline: a.headline, dek: a.dek, body: a.body, createdAt: a.created_at }
}

// Manual tool-use loop. Returns the model's final text. Forces a text turn if the loop
// reaches the iteration cap so it can never spin forever.
async function runConversation(anthropic: Anthropic, system: string, userText: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userText }]
  const systemBlocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await anthropic.messages.create({
      model: NEWSROOM_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      tools: NEWSROOM_TOOLS,
      messages,
    })
    if (resp.stop_reason !== 'tool_use') return textOf(resp)

    messages.push({ role: 'assistant', content: resp.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = resp.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((tu) => {
        const { content, isError } = executeTool(tu.name, tu.input as Record<string, unknown>)
        return { type: 'tool_result', tool_use_id: tu.id, content, is_error: isError }
      })
    messages.push({ role: 'user', content: toolResults })
  }

  const final = await anthropic.messages.create({
    model: NEWSROOM_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks,
    tools: NEWSROOM_TOOLS,
    tool_choice: { type: 'none' },
    messages,
  })
  return textOf(final)
}

// Second pass: convert the free-text draft into {headline, dek, body} via structured outputs.
async function structure(anthropic: Anthropic, draft: string): Promise<{ headline: string; dek: string; body: string }> {
  const resp = await anthropic.messages.create({
    model: NEWSROOM_MODEL,
    max_tokens: MAX_TOKENS,
    system: STRUCTURE_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
    messages: [{ role: 'user', content: `Draft race report:\n\n${draft}\n\nReturn it as JSON with fields headline, dek, and body.` }],
  })
  return JSON.parse(textOf(resp)) as { headline: string; dek: string; body: string }
}

async function generateRaceReview(year: number, round: number): Promise<NewsroomResult<RaceReview>> {
  const anthropic = getAnthropic()
  if (!anthropic) return { ok: false, error: 'NO_API_KEY' }
  try {
    const draft = await runConversation(
      anthropic,
      RACE_REVIEW_SYSTEM,
      `Write a race review for round ${round} of the ${year} season.`,
    )
    const { headline, dek, body } = await structure(anthropic, draft)
    upsertNewsArticle({
      type: 'race-review', seasonId: getSeasonIdByYear(year), year, round,
      headline, dek, body, model: NEWSROOM_MODEL,
    })
    return { ok: true, data: { year, round, headline, dek, body } }
  } catch (e) {
    return { ok: false, error: 'LLM_ERROR', message: e instanceof Error ? e.message : String(e) }
  }
}

// --- Server actions (called from the newsroom page) ---

export async function actionNewsroomAvailable(): Promise<boolean> {
  return hasApiKey()
}

export async function actionListRaceReviews(): Promise<RaceReview[]> {
  return listRaceReviews().map(toReview)
}

export async function actionGetOrGenerateRaceReview(year: number, round: number): Promise<NewsroomResult<RaceReview>> {
  const existing = getRaceReview(year, round)
  if (existing) return { ok: true, data: toReview(existing) }
  return generateRaceReview(year, round)
}

export async function actionRegenerateRaceReview(year: number, round: number): Promise<NewsroomResult<RaceReview>> {
  return generateRaceReview(year, round)
}

export async function actionSearchNewsroom(query: string): Promise<NewsroomResult<NewsroomSearchResult>> {
  const anthropic = getAnthropic()
  if (!anthropic) return { ok: false, error: 'NO_API_KEY' }
  const trimmed = query.trim()
  if (!trimmed) return { ok: false, error: 'NO_OUTPUT' }
  try {
    const answer = await runConversation(anthropic, SEARCH_SYSTEM, trimmed)
    if (!answer) return { ok: false, error: 'NO_OUTPUT' }
    return { ok: true, data: { answer } }
  } catch (e) {
    return { ok: false, error: 'LLM_ERROR', message: e instanceof Error ? e.message : String(e) }
  }
}
