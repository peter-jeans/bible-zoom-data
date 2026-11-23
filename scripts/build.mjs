// Builds the static Bible Zoom data site into dist/.
//
// Stage 1 (now): publish the curated seed data in seed/bible unchanged.
// Stage 2 (next): generate further chapters from open sources, in priority order
// (contested passages, then popular ones, then reader requests, then the rest),
// and merge them with the seed. Sources and licences are listed in seed/bible/sources.json.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

const out = argv[2] || 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('seed/bible', out, { recursive: true });
// GitHub Pages: serve files as they are (no Jekyll processing).
await writeFile(`${out}/.nojekyll`, '');
console.log(`Built static data into ${out}/`);
