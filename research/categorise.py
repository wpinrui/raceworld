"""Categorise scraped headlines with rule-based keyword patterns.

Reads research/the-race-headlines.md, prints:
  - overall histogram (count + % + bar), sorted
  - category x month matrix (seasonality)
  - coverage summary
Writes:
  - research/histogram.md          (the above, for the record)
  - research/uncategorised-sample.md  (100 random unmatched headlines for LLM review)

Run:  python research/categorise.py
"""
import re, os, random, collections

HERE = os.path.dirname(os.path.abspath(__file__))
IN_PATH = os.path.join(HERE, "the-race-headlines.md")
HIST_PATH = os.path.join(HERE, "histogram.md")
SAMPLE_PATH = os.path.join(HERE, "uncategorised-sample.md")
SAMPLE_N = 100
SAMPLE_SEED = 42

# Ordered: first matching category wins. Put specific/rare/unambiguous patterns above
# generic ones. media_feature / game_sim / obituary use distinctive tokens so they go high.
CATEGORIES = [
    ("media_feature",      [r"podcast", r"^video\b", r"\bquiz\b", r"^top \d+", r"we rank", r"worst to best", r"\bnetflix\b", r"drive to survive", r"tech show", r"things we learned", r"what we learned", r"\bgallery\b", r"^watch\b", r"^listen\b", r"interview", r"your questions answered", r"q&a", r"revisited", r"competition with"]),
    ("game_sim",           [r"\bcodemasters\b", r"video game", r"f1 \d{2} game", r"f1 games?", r"simracing", r"sim racing", r"iracing", r"esports"]),
    ("obituary",           [r"\bdies\b", r"\bdead\b", r"aged \d+", r"passes away", r"obituary", r"\btribute\b", r"\bmourns?\b"]),
    ("testing",            [r"\btest(ing)?\b", r"shakedown", r"pre[- ]?season"]),
    ("practice",           [r"\bpractice\b", r"\bfp[123]\b", r"free practice", r"\bfriday\b"]),
    ("sprint",             [r"\bsprint\b"]),
    ("qualifying",         [r"\bpole\b", r"qualif", r"\bquali\b", r"\bgrid\b"]),
    ("penalty_stewards",   [r"penal", r"steward", r"grid drop", r"disqualif", r"\bdsq\b", r"reprimand", r"investigat"]),
    ("crash_incident",     [r"crash", r"collision", r"\bclash\b", r"contact", r"\bspin\b", r"red flag", r"shunt", r"accident"]),
    ("reliability_dnf",    [r"\bdnf\b", r"retire(s|d|ment)? from", r"engine (failure|blow)", r"reliab", r"breakdown", r"mechanical"]),
    ("injury_health",      [r"injur", r"\bfit\b", r"withdraw", r"illness", r"surgery", r"hospital"]),
    ("career_retirement",  [r"\bretire", r"final season", r"farewell", r"last race", r"calls time", r"hangs up", r"life after f1"]),
    ("rookie_debut",       [r"\bdebut\b", r"\brookie\b", r"first f1", r"\bmaiden\b", r"step up"]),
    ("car_launch_livery",  [r"\blaunch\b", r"\blivery\b", r"\bunveil", r"\breveal(s|ed)? .*\bcar\b", r"new car", r"car to run", r"run on track"]),
    ("calendar_entry",     [r"\bcalendar\b", r"postpone", r"cancel(led|lation)?", r"\d+[- ]race", r"returns? to", r"race added", r"new team", r"grid (spot|expansion)", r"entry bid", r"\bgrands prix\b"]),
    ("governance_legal",   [r"cost cap", r"\bappeal", r"impound", r"copying", r"tribunal", r"\bcourt\b", r"rejection", r"\bentry\b", r"andretti", r"\bsaga\b", r"allegation"]),
    ("driver_signing",     [r"\bsigns?\b", r"\bcontract\b", r"\bdeal\b", r"extension", r"\bstays?\b", r"re[- ]?sign", r"new .*deal", r"confirmed (for|at)", r"agrees", r"route to", r"\bjoins?\b", r"move for \d"]),
    ("driver_exit",        [r"\baxed\b", r"\bdropped\b", r"\bsacked\b", r"replace", r"\bout at\b", r"\bsplit\b", r"\bexit\b", r"leaves?\b", r"to leave", r"\bquits?\b", r"leaving f1"]),
    ("silly_season",       [r"rumour", r"\blinked\b", r"\btargets?\b", r"eyeing", r"could (join|move)", r"\bseat\b", r"line[- ]?up", r"\bmarket\b", r"sabbatical", r"candidates", r"remaining seat", r"shortlist", r"fallback", r"\bduties\b"]),
    ("management",         [r"team principal", r"\bboss\b", r"\bceo\b", r"resign", r"\bhire", r"director", r"steps down", r"takes over"]),
    ("rule_change",        [r"\brules?\b", r"regulation", r"\bfia\b", r"\bban\b", r"clampdown", r"directive", r"loophole", r"protest", r"legality", r"ruling"]),
    ("technical_upgrade",  [r"upgrade", r"\bfloor\b", r"developmen", r"gary anderson", r"\bwing\b", r"sidepod", r"\baero\b", r"bargeboard", r"porpoising", r"ground effect", r"\bengine\b", r"\bdesign\b"]),
    ("team_orders",        [r"team order"]),
    ("championship_state", [r"\btitle\b", r"championship", r"clinch", r"decider", r"\bleader\b", r"standing", r"points lead"]),
    ("feud_controversy",   [r"\brow\b", r"\bfeud\b", r"slams?", r"hits back", r"hits out", r"criticis", r"controvers", r"\bblast", r"\bfury\b", r"\bspat\b", r"\brage\b", r"incensed", r"war"]),
    ("sponsor_finance",    [r"sponsor", r"\binvest", r"budget cap", r"\bfunding\b", r"financ", r"buyout", r"takeover", r"revenue", r"liquidity", r"payments?", r"\d+ ?bn", r"profit"]),
    ("opinion_columnist",  [r"mark hughes", r"edd straw", r"gary anderson", r"scott mitchell", r"steiner", r"\bcolumn\b", r"^opinion\b", r"our writers"]),
    ("quote_statement",    [r"\bsays?\b", r"\bsaid\b", r"admits?", r"insists?", r"\bclaims?\b", r"\bwarns?\b", r"\bhails?\b", r"praises?", r"defends?", r"denies", r"reveals?", r"clarif", r"outlines?", r"responds?", r"\bbacks?\b", r"\burges?\b", r"\btells?\b", r"reacts?", r"endorsement", r"comments", r"explains?", r"\bvents?\b", r"frustrated"]),
    ("other_series",       [r"formula e", r"\bindycar\b", r"indy 500", r"extreme e", r"w series", r"\bnascar\b", r"\bwec\b", r"\bmotogp\b", r"formula 2", r"\bf2\b", r"\bf3\b", r"ganassi", r"le mans", r"super formula", r"gt series", r"e ?sport", r"legends trophy", r"pro cup", r"\boval\b", r"nordschleife"]),
    ("preview_schedule",   [r"expect", r"preview", r"schedule", r"timings", r"what to watch", r"\bweekend\b", r"\bpredict", r"things to"]),
    ("race_review",        [r"\bwins?\b", r"victory", r"grand prix", r"\bgp\b", r"\bresult", r"recap", r"\bbeats?\b", r"triumph", r"dominat", r"how .* won", r"\bpodium\b"]),
    ("analysis_opinion",   [
        r"^why ", r"^how ", r"\bverdict\b", r"big questions?", r"\branke?d?\b", r"deep dive", r"report card",
        r"what .* (means|next|really)", r"\bproblem", r"\bneeds to\b", r"wasting", r"expos(e|ed|ing)",
        r"\btruth\b", r"\breality\b", r"realistic", r"underrated", r"overlooked", r"\bwhat if\b",
        r"at risk", r"under (most )?pressure", r"where (can|should)", r"\bvs\b", r"compare", r"similarity",
        r"\bpoised\b", r"\bbattle\b", r"struggl", r"slump", r"turnaround", r"breakthrough", r"supremacy",
        r"weakness", r"the (one|key|real|biggest|strengths?|lesser)", r"is .* (really|right|enough)",
        r"^should ", r"\bmust\b", r"could (take|prove|make)", r"enough for", r"on top", r"\bheroics?\b",
        r"\bpicture\b", r"\bhints?\b", r"\bclues?\b", r"\bstrengths?\b", r"\bmisconception",
        r"driving style", r"\btraits?\b", r"the (sour|surprise|distraction|move that|factor|hint)",
        r"\binside\b", r"transformation", r"stock (has )?(risen|fallen)", r"miracle", r"plight",
        r"\bconcerns?\b", r"\bmyth\b", r"peculiar", r"vulnerable", r"humbling", r"regression",
        r"\breboot\b", r"epilogue", r"era[- ]defining", r"paying (the )?price", r"\bnightmare\b",
        r"validate", r"\bparallel\b", r"realism", r"what .* (brings|adding|should do)",
    ]),
]
COMPILED = [(name, [re.compile(p, re.I) for p in pats]) for name, pats in CATEGORIES]
ORDER = [name for name, _ in CATEGORIES] + ["uncategorised"]


def categorise(headline):
    for name, pats in COMPILED:
        if any(p.search(headline) for p in pats):
            return name
    return "uncategorised"


def parse():
    rows = []  # (ym, headline)
    line_re = re.compile(r"^- (\d{4})-(\d{2})-\d{2} \| (.+)$")
    with open(IN_PATH, encoding="utf-8") as f:
        for line in f:
            m = line_re.match(line.strip())
            if m:
                rows.append((f"{m.group(1)}-{m.group(2)}", m.group(3)))
    return rows


def bar(n, mx, width=40):
    return "#" * (round(width * n / mx) if mx else 0)


def main():
    if not os.path.exists(IN_PATH):
        print(f"Missing {IN_PATH} — run fetch_headlines.py first.")
        return
    rows = parse()
    total = len(rows)
    overall = collections.Counter()
    by_month = collections.defaultdict(collections.Counter)  # cat -> {ym: n}
    uncategorised = []
    for ym, h in rows:
        cat = categorise(h)
        overall[cat] += 1
        by_month[cat][ym] += 1
        if cat == "uncategorised":
            uncategorised.append(h)

    months = sorted({ym for ym, _ in rows})
    lines = [f"# Headline categories ({total} headlines)", ""]
    mx = max(overall.values()) if overall else 1
    lines.append("## Overall\n")
    for name in ORDER:
        n = overall.get(name, 0)
        pct = 100 * n / total if total else 0
        lines.append(f"{name:20s} {n:5d}  {pct:5.1f}%  {bar(n, mx)}")

    lines.append("\n## By month (category x month)\n")
    header = f"{'category':20s} " + " ".join(f"{m[2:]:>5s}" for m in months)
    lines.append(header)
    for name in ORDER:
        cells = " ".join(f"{by_month[name].get(m, 0):>5d}" for m in months)
        lines.append(f"{name:20s} {cells}")

    uncat_pct = 100 * len(uncategorised) / total if total else 0
    lines.append(f"\nUncategorised: {len(uncategorised)} ({uncat_pct:.1f}%)")

    report = "\n".join(lines)
    print(report)
    with open(HIST_PATH, "w", encoding="utf-8") as f:
        f.write(report + "\n")

    # Programmatic random sample of unmatched headlines for LLM analysis.
    rng = random.Random(SAMPLE_SEED)
    sample = rng.sample(uncategorised, min(SAMPLE_N, len(uncategorised)))
    with open(SAMPLE_PATH, "w", encoding="utf-8") as f:
        f.write(f"# {len(sample)} random uncategorised headlines (of {len(uncategorised)})\n\n")
        f.write("\n".join(f"- {h}" for h in sorted(sample)) + "\n")
    print(f"\nWrote {HIST_PATH} and {SAMPLE_PATH} ({len(sample)} sampled).")


if __name__ == "__main__":
    main()
