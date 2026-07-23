# RaceWorld

RaceWorld is a single-player Formula 1 management sim that runs in the browser. Pick a mode (Sandbox, Team Manager, or Driver), then live a full career: qualifying and race weekends with tyre strategy, push levels and pit calls, a driver market with signings and contracts, car development across multi-rating chassis, and season-by-season history that the in-game newsroom writes about as it happens. The race engine simulates every lap client-side; results, standings, and careers persist to a local SQLite database. Built with Next.js, TypeScript, Zustand, and the Anthropic API for generated news copy.

## Getting started

```bash
npm install
npm run db:init
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Attribution

Track backdrop photos are used under their original licences. Images may be resized or re-encoded for use as in-game backdrops.

| Track | File | Image | Author | Licence |
|---|---|---|---|---|
| Monaco | `public/track-backdrops/monaco.png` | [2013 Monaco Grand Prix - Sunday](https://commons.wikimedia.org/wiki/File:2013_Monaco_Grand_Prix_-_Sunday.jpg) | Charles Coates/LAT Photographic, via United Autosports (Flickr) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
