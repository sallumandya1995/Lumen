import {readFile,writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import assert from 'node:assert/strict';
const dir=new URL('../.sites-runtime/governance-server-tests/',import.meta.url);
// Generate fresh signed evidence so this suite also runs independently.
await import('./governance-server.mjs');
const {buildGovernancePdf}=await import(new URL('lib/governance/evidence-pdf.mjs',dir));
const bundle=JSON.parse(await readFile(new URL('evidence.json',dir),'utf8'));
const bytes=await buildGovernancePdf(bundle,new Uint8Array(await readFile(new URL('../public/fonts/DejaVuSans.ttf',import.meta.url))));
const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getTitle(),'Lumen - Agent governance evidence');assert(pdf.getPageCount()>=4);
await writeFile(new URL('evidence.pdf',dir),bytes);
console.log(`PASS: governance PDF generated (${pdf.getPageCount()} pages) with signed JSON evidence attachment.`);
