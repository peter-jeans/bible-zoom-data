# bible-zoom-data

Static, openly licensed data for **Bible Zoom**, a free, layered, zoomable Bible reader.
The app loads these files directly in the reader's browser from this repository's
GitHub Pages site. There is no database and no per-request cost.

## Layout

```
seed/bible/                 curated source data (the single authority for the files below)
  registry.json             layer registry: order, groups, categories, colours
  sources.json              sources, licences and attributions
  coverage.json             which layers are built for which chapters
  text/{translation}/{book}/{ch}.json
  layers/{layer}/{book}/{ch}.json
  rollups/{book}.json, rollups/bible.json
  library/…, geo/places.json
scripts/build.mjs           builds the publishable site into dist/
scripts/validate.mjs        checks a release before it is published
.github/workflows/publish.yml   build → validate → publish to GitHub Pages
```

Generated output (`dist/`) is never committed. It is published as a Pages artifact on each run,
so the repository history doesn't grow with every build.

## Running it locally

```bash
node scripts/build.mjs dist && node scripts/validate.mjs dist
```

## Publishing

Every push to `main`, the weekly schedule, and manual runs ("Run workflow") build, validate and
publish to GitHub Pages. A release that fails validation is not published.

The app reads this site through its `VITE_DATA_BASE_URL` setting.

## Rules

- Only public-domain, CC0, CC BY or CC BY-SA material is embedded. Copyrighted works are
  recorded as **link only**, never copied. The validator enforces this.
- Every source records its author, date, tradition, licence and link (`sources.json`).
- No credentials from other projects are used here. Workflow permissions are limited to
  publishing this repository's Pages site.

## Licence

- Scripts: MIT (see `LICENSE`).
- Data: see `DATA-LICENSE.md`.
