import type { NewsContext, NewsArticle } from './engine'
import { buildSeasonAnalysis, previewCast } from './season-analysis'
import { teamName } from './lookups'
import { plural, listJoin, fill, pick } from './util'
import { paras } from './copy'
import seasonPreviewCopy from './season-preview-copy.json'

export function seasonPreview(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.teams.length === 0 || ctx.completedRounds > 0) return []
  const analysis = buildSeasonAnalysis(ctx)
  const cast = previewCast(ctx, analysis)
  const c = seasonPreviewCopy
  const seed = `season-preview-${ctx.year}`
  const dn = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? id
  const champion = cast.reigningChampion ? dn(cast.reigningChampion) : ''
  const topExpected = [...analysis.driverExpectations.values()].sort((a, b) => a.expectedRank - b.expectedRank)[0]?.driverId
  const topFavId = cast.titleFavourites[0] ?? topExpected
  // When the reigning champion is also the top favourite, {fav} becomes the leading CHALLENGER (so the
  // headline doesn't name the same driver twice); otherwise {fav} is the top favourite itself.
  const championIsTopFav = !!cast.reigningChampion && topFavId === cast.reigningChampion
  const challengerId = cast.titleFavourites.find((id) => id !== cast.reigningChampion) ?? topExpected
  const fav = dn((championIsTopFav ? challengerId : topFavId) ?? '')
  const slots = { year: ctx.year, fav, champion, constructor: cast.reigningConstructor ? teamName(ctx, cast.reigningConstructor) : '' }

  // Data-driven cast facts: every descriptor below is a real career/market figure, so the copy tracks the
  // world rather than asserting a hardcoded label. Missing data degrades to the plainest TRUE label.
  const draftBy = new Map((ctx.draft ?? []).map((p) => [p.driverId, p]))
  const facts = (id: string) => {
    const d = ctx.drivers.find((x) => x.id === id)
    const car = ctx.careers?.[id]
    const team = teamName(ctx, d?.teamId ?? '')
    const prev = draftBy.get(id)?.prevTeamName ?? ''
    return {
      name: d?.name ?? id, team,
      titles: car?.titles ?? 0, wins: car?.wins ?? 0, starts: car?.starts ?? 0, seasons: car?.seasons ?? 0, age: d?.age ?? 0,
      rookie: (car?.starts ?? 0) === 0,
      veteran: (car?.seasons ?? 0) >= 4,
      fromTeam: prev && prev !== team ? prev : '', // prior team from the Signing Day draft ('' = pool/rookie/stayer)
    }
  }
  type Facts = ReturnType<typeof facts>
  // Favourite / dark-horse name: car always, plus the strongest career mark (champion > race-winner).
  const favTag = (f: Facts) => (f.titles >= 2 ? `, ${f.titles}-time champion` : f.titles === 1 ? ', former champion' : f.wins > 0 ? ', race-winner' : '')
  const favName = (f: Facts) => `${f.name} (${f.team}${favTag(f)})`
  // Veteran name: age (always real, the defining veteran fact) plus the headline achievement when one
  // exists. Never cites starts/seasons — in an early save those are near-zero and read as misleading.
  const vetTag = (f: Facts, ageSeen: boolean) => {
    const ach = f.titles >= 1 ? `${f.titles}-time champion` : f.wins > 0 ? `${f.wins} career ${plural(f.wins, 'win')}` : ''
    return `${ageSeen ? `also ${f.age}` : `age ${f.age}`}${ach ? `, ${ach}` : ''}`
  }
  // A veteran name list that collapses a repeated age to "also N", so two same-age veterans in one
  // sentence don't both read "age 37".
  const vetNames = (vs: typeof cast.veterans): string[] => {
    const seen = new Set<number>()
    return vs.map((v) => {
      const f = facts(v.driverId)
      const out = `${f.name} (${vetTag(f, seen.has(f.age))})`
      seen.add(f.age)
      return out
    })
  }
  // New-team driver: strongest framing — champion, then where they were signed from, then veteran/rookie.
  const ntPhrase = (f: Facts) =>
    f.titles >= 2 ? `${f.titles}-time champion ${f.name}`
    : f.titles === 1 ? `former champion ${f.name}`
    : f.fromTeam ? `ex-${f.fromTeam} driver ${f.name}`
    : f.veteran ? `veteran ${f.name}`
    : f.wins > 0 ? `race-winner ${f.name}`
    : f.starts > 0 ? `the experienced ${f.name}`
    : `rookie ${f.name}`

  const sections: string[] = []
  if (champion) sections.push(fill(pick(c.reigning, `${seed}|reign`), slots))
  if (cast.titleFavourites.length) sections.push(fill(pick(c.favourites, `${seed}|fav`), { ...slots, names: listJoin(cast.titleFavourites.map((id) => favName(facts(id)))) }))
  if (cast.darkHorses.length) sections.push(fill(pick(c.darkHorses, `${seed}|dh`), { ...slots, names: listJoin(cast.darkHorses.map((id) => favName(facts(id)))) }))
  if (cast.bestOfRest.length) sections.push(fill(pick(c.bestOfRest, `${seed}|bor`), { ...slots, teams: listJoin(cast.bestOfRest.map((id) => teamName(ctx, id))) }))
  const resurgent = vetNames(cast.veterans.filter((v) => v.kind === 'resurgent'))
  const twilight = vetNames(cast.veterans.filter((v) => v.kind === 'twilight'))
  if (resurgent.length) sections.push(fill(pick(c.veteransResurgent, `${seed}|vr`), { ...slots, names: listJoin(resurgent) }))
  if (twilight.length) sections.push(fill(pick(c.veteransTwilight, `${seed}|vt`), { ...slots, names: listJoin(twilight) }))
  if (cast.rookies.length) sections.push(fill(pick(c.rookies, `${seed}|rk`), { ...slots, names: listJoin(cast.rookies.map(dn)) }))
  // New-team coverage fires only when SOME teams are new against an otherwise established grid — that
  // contrast is the story. When the whole grid is new (first season of a save), there is no contrast to
  // draw and the favourites / midfield / rookie sections already introduce the field, so this is skipped.
  if (cast.newTeams.length && cast.newTeams.length < ctx.teams.length) {
    const ntLine = (tid: string, i: number): string => {
      const team = teamName(ctx, tid)
      const ds = ctx.drivers.filter((d) => d.teamId === tid).map((d) => facts(d.id))
      const anchors = ds.filter((f) => !f.rookie)
      const rookies = ds.filter((f) => f.rookie)
      const base = { ...slots, team }
      if (anchors.length && rookies.length) return fill(pick(c.newTeams.anchorAndRookie, `${seed}|nt${i}`), { ...base, anchors: listJoin(anchors.map(ntPhrase)), rookies: listJoin(rookies.map(ntPhrase)) })
      if (anchors.length) return fill(pick(c.newTeams.anchorLed, `${seed}|nt${i}`), { ...base, anchors: listJoin(anchors.map(ntPhrase)) })
      return fill(pick(c.newTeams.allRookie, `${seed}|nt${i}`), { ...base, names: listJoin(ds.map((f) => f.name)) })
    }
    const shown = cast.newTeams.slice(0, 3)
    let text = shown.map((tid, i) => ntLine(tid, i)).join(' ')
    const extra = cast.newTeams.slice(3)
    if (extra.length) text += ` ${listJoin(extra.map((id) => teamName(ctx, id)))} also join the grid for the first time.`
    sections.push(text)
  }

  const hArr = !champion ? c.headlineNoChamp : championIsTopFav ? c.headlineDefendingFav : c.headline
  const dArr = !champion ? c.dekNoChamp : championIsTopFav ? c.dekDefendingFav : c.dek
  const headline = fill(pick(hArr, `${seed}|h`), slots)
  const dek = fill(pick(dArr, `${seed}|d`), slots)
  const body = paras(fill(pick(c.intro, `${seed}|intro`), slots), ...sections)
  return [{ id: seed, category: 'preview_schedule', round: 0, priority: 85, headline, dek, body }]
}
