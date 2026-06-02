// Client-safe newsroom DTOs. No server imports — safe to import from client components.

export interface RaceReview {
  year: number
  round: number
  headline: string
  dek: string | null
  body: string
  createdAt?: string
}

export interface NewsroomSearchResult {
  answer: string
}

// Returned by actions instead of throwing, so the UI can render a friendly state.
export type NewsroomError = 'NO_API_KEY' | 'LLM_ERROR' | 'NO_OUTPUT' | 'NOT_FOUND'

export type NewsroomResult<T> = { ok: true; data: T } | { ok: false; error: NewsroomError; message?: string }
