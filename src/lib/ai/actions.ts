'use server'

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic, hasApiKey, NEWSROOM_MODEL, MAX_TOOL_ITERATIONS, MAX_TOKENS } from './client'
import { NEWSROOM_TOOLS, executeTool, gatherRaceReviewContext } from './tools'
import { getRaceReview, listRaceReviews, upsertNewsArticle, getSeasonIdByYear, type DbNewsArticle } from '@/lib/db/queries'
import type { RaceReview, NewsroomResult, NewsroomSearchResult } from './types'

const RACE_REVIEW_SYSTEM = `You are a motorsport journalist covering an alternate-reality Formula 1 world. This world has its OWN drivers, teams, and history; there is no real-world F1.

The user message contains ALL the data for the race: the full classification (finishing order, grid positions, points, DNFs, lapsCompleted, and gapToWinnerSeconds), the detected feats, the championship standings after the round, and the season's earlier races. Write the review using ONLY that data.

Hard rules:
- Every factual claim (positions, gaps, points, DNFs, championship state, who leads) MUST come from the provided data. Never invent drivers, teams, lap times, margins, or records.
- State a finishing margin ONLY from gapToWinnerSeconds (in seconds). The winner has no gap. If a non-winner's gapToWinnerSeconds is null, they did NOT finish (DNF) — never state a time or "held off by X seconds" for them.
- Use the standings data for any championship-lead or points claims; do the arithmetic from the numbers given.
- Write in a concise sports-journalism voice, ~150-300 words, plain paragraphs.
- Do NOT use markdown, headings, bold, em dashes, or en dashes. Use commas, periods, or parentheses instead.
- You may call the tools ONLY to fetch a driver's or team's career/honours if a feat makes them especially newsworthy — never for race facts (those are already provided).`

const SEARCH_SYSTEM = `You are the newsroom for an alternate-reality Formula 1 world. This world has its OWN drivers, teams, and history; there is no real-world F1, only the data returned by your tools exists.

Answer the player's query as a short, factual news piece grounded in the tools:
- Call search_index first to resolve any driver or team name into the id the other tools need.
- Treat the player's premise as true unless a tool result directly contradicts it; if it is contradicted, correct it using the stats.
- Every factual claim MUST come from a tool result. Never invent drivers, teams, numbers, or records.
- Keep it concise, in a plain sports-journalism voice. No em dashes.

If the tools return no relevant data, reply with one short, flat sentence stating that (e.g. "No races have been recorded yet."). Do NOT apologise, do NOT suggest trying again later, do NOT offer to look something else up, and do NOT speculate about database issues.`

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

// Belt-and-suspenders: strip em/en dashes from generated copy even if the model ignores
// the prompt. Collapses surrounding whitespace into a single comma+space.
function noDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ', ')
}

function toReview(a: DbNewsArticle): RaceReview {
  return { year: a.year, round: a.round ?? 0, headline: a.headline, dek: a.dek, body: a.body, createdAt: a.created_at }
}

function log(...args: unknown[]) {
  console.log('[newsroom]', ...args)
}

// Manual tool-use loop. Returns the model's final text. Forces a text turn if the loop
// reaches the iteration cap so it can never spin forever.
async function runConversation(anthropic: Anthropic, system: string, userText: string, label: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userText }]
  const systemBlocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  log(`${label}: start (model=${NEWSROOM_MODEL}, userText ${userText.length} chars)`)

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await anthropic.messages.create({
      model: NEWSROOM_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      tools: NEWSROOM_TOOLS,
      messages,
    })
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    log(`${label}: iter ${i} stop=${resp.stop_reason} toolCalls=[${toolUses.map((t) => t.name).join(', ')}] usage=${resp.usage.input_tokens}in/${resp.usage.output_tokens}out`)
    if (resp.stop_reason !== 'tool_use') {
      const text = textOf(resp)
      log(`${label}: final text (${text.length} chars):\n${text}`)
      return text
    }

    messages.push({ role: 'assistant', content: resp.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => {
      const { content, isError } = executeTool(tu.name, tu.input as Record<string, unknown>)
      log(`${label}: tool ${tu.name}(${JSON.stringify(tu.input)}) -> ${isError ? 'ERROR' : 'ok'} (${content.length} chars)`)
      return { type: 'tool_result', tool_use_id: tu.id, content, is_error: isError }
    })
    messages.push({ role: 'user', content: toolResults })
  }

  log(`${label}: hit iteration cap, forcing final text turn`)
  const final = await anthropic.messages.create({
    model: NEWSROOM_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks,
    tools: NEWSROOM_TOOLS,
    tool_choice: { type: 'none' },
    messages,
  })
  const text = textOf(final)
  log(`${label}: forced final text (${text.length} chars):\n${text}`)
  return text
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
  const context = gatherRaceReviewContext(year, round)
  if (!context.thisRace) { log(`race-review ${year} r${round}: NO RACE DATA in DB`); return { ok: false, error: 'NOT_FOUND' } }
  const winner = context.thisRace.results.find((r) => r.finish === 1)
  const second = context.thisRace.results.find((r) => r.finish === 2)
  log(`race-review ${year} r${round}: ${context.thisRace.circuit} | ${context.thisRace.results.length} results, ${context.feats.length} feats, ${context.previousRaces.length} prior races | winner=${winner?.driver} P2=${second?.driver} gapP2=${second?.gapToWinnerSeconds}s`)
  try {
    const userText = `Write a race review for round ${round} of the ${year} season. Use ONLY this data:\n\n${JSON.stringify(context)}`
    const draft = await runConversation(anthropic, RACE_REVIEW_SYSTEM, userText, `race-review ${year} r${round}`)
    const out = await structure(anthropic, draft)
    log(`race-review ${year} r${round}: structured headline="${out.headline}"`)
    const headline = noDashes(out.headline)
    const dek = noDashes(out.dek)
    const body = noDashes(out.body)
    upsertNewsArticle({
      type: 'race-review', seasonId: getSeasonIdByYear(year), year, round,
      headline, dek, body, model: NEWSROOM_MODEL,
    })
    return { ok: true, data: { year, round, headline, dek, body } }
  } catch (e) {
    log(`race-review ${year} r${round}: ERROR`, e)
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
    const answer = noDashes(await runConversation(anthropic, SEARCH_SYSTEM, trimmed, `search "${trimmed.slice(0, 40)}"`))
    if (!answer) return { ok: false, error: 'NO_OUTPUT' }
    return { ok: true, data: { answer } }
  } catch (e) {
    log('search error', e)
    return { ok: false, error: 'LLM_ERROR', message: e instanceof Error ? e.message : String(e) }
  }
}
