// Rebuild manuals-data/ from the LEMON torrent's two index.json files
// (download only lemon/index.json and charm/index.json, about 150 MB):
//   node scripts/manuals-index.mjs <torrent>/lemon-manuals manuals-data
// Writes manuals-data/makes.json  {make: {year: [charmCount, lemonCount]}}
//    and manuals-data/v/<Make-Slug>/<year>.json  {CHARM: {model: [engine...]}, LEMON: {...}}
// The finder rebuilds each LEMON path as /<make>/<year>/<model + " " + engine>/;
// this refuses to write anything if one vehicle's uriPath breaks that rule.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node scripts/manuals-index.mjs <torrent>/lemon-manuals <out-dir>'); process.exit(1); }
// Python's quote(safe=""): encodeURIComponent plus !'()*
const q = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const slug = make => make.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

const tree = new Map();
for (const db of ['CHARM', 'LEMON']) {
  const { vehicles } = JSON.parse(await readFile(join(src, db.toLowerCase(), 'index.json'), 'utf8'));
  for (const v of vehicles) {
    const [year] = v.years, engine = v.engine || '';
    const label = [v.model, engine].filter(Boolean).join(' ');
    if (`/${q(v.make)}/${year}/${q(label)}/` !== v.uriPath) throw new Error('path rule broken for ' + v.uriPath + '; nothing written');
    const years = tree.get(v.make) || tree.set(v.make, new Map()).get(v.make);
    const dbs = years.get(year) || years.set(year, { CHARM: new Map(), LEMON: new Map() }).get(year);
    (dbs[db].get(v.model) || dbs[db].set(v.model, []).get(v.model)).push(engine);
  }
}
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // code-point order, same as Python's sorted()
await rm(out, { recursive: true, force: true });
const makes = {};
let files = 0, total = 0;
for (const make of [...tree.keys()].sort(byText)) {
  makes[make] = {};
  await mkdir(join(out, 'v', slug(make)), { recursive: true });
  for (const year of [...tree.get(make).keys()].sort(byText)) {
    const dbs = tree.get(make).get(year), doc = {};
    for (const db of ['CHARM', 'LEMON']) {
      if (!dbs[db].size) continue;
      doc[db] = Object.fromEntries([...dbs[db].keys()].sort(byText).map(model => [model, dbs[db].get(model).sort(byText)]));
    }
    const counts = ['CHARM', 'LEMON'].map(db => [...dbs[db].values()].reduce((n, e) => n + e.length, 0));
    makes[make][year] = counts; total += counts[0] + counts[1];
    await writeFile(join(out, 'v', slug(make), year + '.json'), JSON.stringify(doc));
    files++;
  }
}
await writeFile(join(out, 'makes.json'), JSON.stringify(makes));
console.log(`${Object.keys(makes).length} makes, ${files} make/year files, ${total} vehicles`);
