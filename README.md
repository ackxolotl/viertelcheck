# Viertelcheck München

Scores any spot in Munich by what you can reach on foot: groceries, U-Bahn/S-Bahn/tram/bus,
cafés, restaurants, bars, doctors, parks and the Isar, and more. Walking times follow real streets
and paths. Save flats to a shortlist and compare them using each person's own priorities.

**Live site:** https://ackxolotl.github.io/viertelcheck/

## Self-hosting

Everything the site needs is in `dist/` (about 8 MB): `index.html` plus the `data/` folder.
It's a static site with no server code, so any static host works. The files must be served over
http(s). Opening `index.html` straight from disk won't work, because browsers block loading the
data files from `file://`.

**Netlify Drop (quickest):** go to https://app.netlify.com/drop and drag the `dist` folder onto the page.
You get a public URL right away (sign up for a free account to keep the site).

**GitHub Pages (how this repo is published):** `.github/workflows/pages.yml` deploys `dist/`
on every push to `main`. After changing the page or the data, run `node build/assemble.js`, commit
and push. The site updates a minute later.

**On your own machine:**

```sh
python3 -m http.server 8000 --directory dist
# open http://localhost:8000
```

## Sharing a shortlist on a self-hosted copy

The self-hosted site saves your shortlist and priorities in your browser. To combine lists with other people:

1. Enter your name next to the shortlist and press **Copy share link**.
2. Send the link. Whoever opens it gets your flats and your priorities added to their page.
3. They can send their link back the same way. Flats anyone removed stay removed.

The link carries your saved flats, notes, rents and priorities. That part of the URL (after `#`)
never reaches the web server, but anyone you give the link to can read it.

## Rebuilding the data

```sh
# 1. download the Munich OpenStreetMap extract (~260 MB) from BBBike
mkdir -p raw/bbbike && curl -o raw/bbbike/Muenchen.osm.gz https://download.bbbike.org/osm/bbbike/Muenchen/Muenchen.osm.gz
# 2. extract map layers, transit, addresses and the walking network
node --max-old-space-size=8192 build/extract_osm.js raw/bbbike/Muenchen.osm.gz raw
# 3. build data files and the citywide score grid (~30 s)
node --max-old-space-size=8192 build/build.js
# 4. assemble the page: site/index.html (claude.ai artifact) and dist/ (standalone)
node build/assemble.js
```

`raw/pois.tsv` (shops, cafés, doctors, …) comes from the Overpass API: run `build/fetch.sh` first.
`raw/`, `site/data/` and `site/index.html` are generated and not committed; `dist/` is committed because it's what gets published.

| File | What it does |
| --- | --- |
| `build/score.js` | Scoring model and walking-route code, shared by the build and the page |
| `build/extract_osm.js` | Streams the OSM extract into the files in `raw/` |
| `build/build.js` | Builds `site/data/*` and precomputes the score grid |
| `build/assemble.js` | Inlines `score.js` into `site/page.html` and writes `site/index.html` and `dist/` |

## Data licence

Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
The files in `data/` are derived from OpenStreetMap, so keep the attribution visible
(the map already shows it) and share the derived data under the same licence.
