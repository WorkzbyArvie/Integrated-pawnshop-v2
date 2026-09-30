/**
 * Extracts text and its position from a PDFKit-generated PDF, so a layout claim
 * ("this label and its value are on the same row") can be checked rather than
 * eyeballed. Node built-ins only.
 *
 * Handles the subset PDFKit emits: `1 0 0 1 x y Tm` to position, and `[<hex>
 * kern <hex>] TJ` to show a run.
 */
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const buf = fs.readFileSync(file);

const contents = [];
let idx = 0;
while (true) {
  const s = buf.indexOf('stream', idx);
  if (s === -1) break;
  let start = s + 6;
  if (buf[start] === 0x0d) start += 1;
  if (buf[start] === 0x0a) start += 1;
  const end = buf.indexOf('endstream', start);
  if (end === -1) break;
  try {
    const text = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
    if (text.includes('BT')) contents.push(text);
  } catch {
    /* not a flate stream */
  }
  idx = end + 9;
}

const OPERATOR = /(?:[-\d.]+\s+){4}([-\d.]+)\s+([-\d.]+)\s+Tm|\[((?:[^\]]|\\\])*)\]\s*TJ/g;

const pages = contents.map((content) => {
  const runs = [];
  let x = 0;
  let y = 0;
  let match;
  OPERATOR.lastIndex = 0;
  while ((match = OPERATOR.exec(content)) !== null) {
    if (match[1] !== undefined) {
      x = parseFloat(match[1]);
      y = parseFloat(match[2]);
      continue;
    }
    // Concatenate the hex chunks; the numbers between them are kerning.
    const hex = [...match[3].matchAll(/<([0-9a-fA-F]*)>/g)]
      .map((h) => h[1])
      .join('');
    let text = '';
    for (let i = 0; i < hex.length; i += 2) {
      text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    text = text.trim();
    if (text) runs.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, text });
  }
  return runs;
});

pages.forEach((runs, pageIndex) => {
  const byY = new Map();
  for (const run of runs) {
    if (!byY.has(run.y)) byY.set(run.y, []);
    byY.get(run.y).push(run);
  }
  const ys = [...byY.keys()].sort((a, b) => b - a);
  console.log(`\n===== PAGE ${pageIndex + 1} — ${runs.length} runs, ${ys.length} rows =====`);
  for (const y of ys) {
    const cells = byY.get(y).sort((a, b) => a.x - b.x);
    console.log(
      `y=${String(y).padStart(7)}  ` +
        cells.map((c) => `x=${String(c.x).padStart(6)} ${c.text}`).join('  |  '),
    );
  }
});
