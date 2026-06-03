"""Randomly sample articles from a news-playthrough markdown dump for qualitative review.

Usage:  python research/sample_news.py <dump.md> [n] [seed]
        python research/sample_news.py news-sample.md 30 42
"""
import re
import sys
import random


def parse(path):
    text = open(path, encoding="utf-8").read()
    # Articles are separated by a line containing only ---
    chunks = re.split(r"\n---\n", text)
    articles = []
    year = ""
    for c in chunks:
        # A season heading (## 2027) may precede the article in this chunk.
        for ym in re.finditer(r"^## (\d{4})$", c, re.M):
            year = ym.group(1)
        m = re.search(r"^### (.+)$", c, re.M)
        if not m:
            continue
        headline = m.group(1).strip()
        meta = re.search(r"^\*(.+)\*$", c, re.M)
        dek = re.search(r"^_(.+)_$", c, re.M)
        # body = everything after the dek line
        body = ""
        if dek:
            body = c[c.index(dek.group(0)) + len(dek.group(0)):].strip()
        articles.append({
            "year": year,
            "headline": headline,
            "meta": meta.group(1).strip() if meta else "",
            "dek": dek.group(1).strip() if dek else "",
            "body": body,
        })
    return articles


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "news-sample.md"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 42
    arts = parse(path)
    random.seed(seed)
    sample = random.sample(arts, min(n, len(arts)))
    print(f"# Sample of {len(sample)} / {len(arts)} articles (seed={seed})\n")
    for i, a in enumerate(sample, 1):
        print(f"## [{i}] {a['headline']}")
        print(f"_{a['meta']} · {a['year']}_")
        print(f"DEK: {a['dek']}")
        print(a["body"])
        print("\n" + "=" * 60 + "\n")


if __name__ == "__main__":
    main()
