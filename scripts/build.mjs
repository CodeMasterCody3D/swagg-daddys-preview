import { scannerAssets } from './scanner-assets.mjs';
import { cp, mkdir, rm } from 'node:fs/promises';
// Only browser assets are published. Server code, tests, and local data stay out of the static directory.
await rm('public', { recursive: true, force: true });
await mkdir('public');
for (const name of ['index.html','privacy.html','assets','owner','site-config.js','intake.js','media.js','vin.js','vin-core.js','vin-scan.js','vin-lens.js','vin-reader.js','vin-barcode-scale.js']) await cp(name, 'public/' + name, { recursive: true });
await scannerAssets();
console.log('Built public customer site and owner dashboard.');
