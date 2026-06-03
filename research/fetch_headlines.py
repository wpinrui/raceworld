"""Scrape The Race F1 headlines (2024 -> present) from the Wayback CDX API.

Writes research/the-race-headlines.md: unique headlines grouped by month, each line
"YYYY-MM-DD | Headline" (date = archive timestamp, ~publish date).

Run:  python research/fetch_headlines.py
"""
import urllib.request, json, time, re, os

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "the-race-headlines.md")

UA = {"User-Agent": "raceworld-research/1.0 (personal project)"}
CATEGORY = "formula-1"  # change/extend for other series (motogp, indycar, wec, formula-e)


def fetch(url, tries=3, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    for i in range(tries):
        try:
            return urllib.request.urlopen(req, timeout=timeout).read().decode()
        except Exception as e:
            print(f"  retry {i + 1}/{tries}: {e}", flush=True)
            time.sleep(3 * (i + 1))
    return ""


def months(sy, sm, ey, em):
    y, m = sy, sm
    while (y, m) <= (ey, em):
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        yield f"{y}{m:02d}01", f"{ny}{nm:02d}01"
        y, m = ny, nm


def headline_from(url):
    path = re.sub(r"^https?://[^/]+", "", url).rstrip("/")
    parts = [p for p in path.split("/") if p]
    if len(parts) != 2 or parts[0] != CATEGORY:
        return None
    slug = parts[1]
    if "-" not in slug or slug.isdigit() or slug == "page" or "?" in slug:
        return None
    return slug.replace("-", " ").title()


def write_md(best):
    items = sorted(((ts, h) for h, ts in best.items()), key=lambda x: x[0])
    out = [
        "# The Race - F1 headlines (2024 to present)",
        "",
        f"Source: web.archive.org CDX of the-race.com/{CATEGORY}. "
        f"{len(items)} unique headlines. Dates are archive timestamps (approximate publish date).",
        "",
    ]
    cur = None
    for ts, h in items:
        ym = f"{ts[:4]}-{ts[4:6]}"
        if ym != cur:
            cur = ym
            out += ["", f"## {ym}", ""]
        out.append(f"- {ts[:4]}-{ts[4:6]}-{ts[6:8]} | {h}")
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    return len(items)


def main():
    best = {}  # headline -> earliest timestamp
    for frm, to in months(2024, 1, 2024, 12):
        url = (
            "http://web.archive.org/cdx/search/cdx"
            f"?url=the-race.com/{CATEGORY}&matchType=prefix&output=json"
            "&fl=original,timestamp&filter=statuscode:200"
            f"&from={frm}&to={to}&collapse=urlkey&limit=8000"
        )
        raw = fetch(url)
        rows = json.loads(raw)[1:] if raw.strip().startswith("[") else []
        kept = 0
        for u, ts in rows:
            h = headline_from(u)
            if not h:
                continue
            if h not in best or ts < best[h]:
                best[h] = ts
            kept += 1
        total = write_md(best)  # checkpoint after every month
        print(f"{frm[:6]}: {len(rows)} rows, {kept} articles, {total} unique -> saved", flush=True)
        time.sleep(1.0)

    print(f"DONE: {OUT_PATH} ({write_md(best)} headlines)", flush=True)


if __name__ == "__main__":
    main()
