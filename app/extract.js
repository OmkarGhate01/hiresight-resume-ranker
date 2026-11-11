// File -> text, in the browser.
//
// PDF: pdf.js gives us every text run with its x/y position and font size.
// Instead of joining runs left-to-right (which mixes a "Skills" sidebar into
// the job history on two-column resumes) we look for a vertical gutter on
// each page and read the columns one after the other.
//
// DOCX: a .docx is a zip with word/document.xml inside. The browser can
// inflate it with DecompressionStream, so no extra library is needed.

// pdf.js ships with the project in /vendor; the CDN copy is only a fallback
// for hosts where the vendor folder isn't deployed.
const PDFJS_SOURCES = [
  new URL('../vendor/pdfjs/', import.meta.url).href,
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/',
];

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      let lastErr;
      for (const base of PDFJS_SOURCES) {
        try {
          const lib = await import(base + 'pdf.min.mjs');
          lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
          return lib;
        } catch (err) {
          lastErr = err;
        }
      }
      pdfjsPromise = null;
      throw new Error('Could not load the PDF reader: ' + (lastErr?.message || 'unknown error'));
    })();
  }
  return pdfjsPromise;
}

export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdf(file);
  if (name.endsWith('.docx')) return extractDocx(file);
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    return { text: await file.text(), meta: { pages: 1, columns: 1 } };
  }
  if (name.endsWith('.doc')) throw new Error('Old .doc files are not supported - save it as .docx or PDF');
  throw new Error('Unsupported file type');
}

// ---------------- PDF ----------------

async function extractPdf(file) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;

  const pageTexts = [];
  let columnsSeen = 1;
  let tinyDropped = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, , d, x, y] = it.transform;
      const size = Math.hypot(a, b) || Math.abs(d) || 10;
      // 1-3pt text is almost always hidden keyword stuffing, not content
      if (size < 3.5) {
        tinyDropped++;
        continue;
      }
      items.push({ str: it.str, x, y, w: it.width || it.str.length * size * 0.5, size });
    }

    const split = findGutter(items, viewport.width);
    if (split) {
      columnsSeen = 2;
      // runs that cross the gutter (a centred name banner, usually) go first,
      // then the left column top to bottom, then the right one
      const spans = items.filter((i) => i.x < split - 2 && i.x + i.w > split + 2);
      const rest = items.filter((i) => !spans.includes(i));
      const left = rest.filter((i) => i.x + i.w / 2 < split);
      const right = rest.filter((i) => i.x + i.w / 2 >= split);
      pageTexts.push([toLines(spans), toLines(left), toLines(right)].filter(Boolean).join('\n\n'));
    } else {
      pageTexts.push(toLines(items));
    }
    page.cleanup();
  }
  const pages = doc.numPages;
  await task.destroy();

  const text = pageTexts.join('\n\n');
  if (text.replace(/\s/g, '').length < 50) {
    throw new Error('No selectable text found - this looks like a scanned PDF (OCR is not supported in the browser build)');
  }
  return { text, meta: { pages, columns: columnsSeen, tinyTextDropped: tinyDropped } };
}

// Try vertical lines between 25% and 75% of the page width and pick the one
// crossed by the fewest text runs. Only accept it if it really separates two
// populated columns.
export function findGutter(items, pageWidth) {
  if (items.length < 20) return null;
  let best = null;
  for (let x = pageWidth * 0.25; x <= pageWidth * 0.75; x += 4) {
    let crossing = 0;
    let left = 0;
    let right = 0;
    for (const it of items) {
      if (it.x < x - 2 && it.x + it.w > x + 2) crossing++;
      else if (it.x + it.w <= x) left++;
      else right++;
    }
    if (!best || crossing < best.crossing) best = { x, crossing, left, right };
  }
  if (!best) return null;
  const n = items.length;
  const balanced = best.left > n * 0.15 && best.right > n * 0.15;
  const clean = best.crossing <= Math.max(2, n * 0.04);
  return balanced && clean ? best.x : null;
}

function toLines(items) {
  if (!items.length) return '';
  // pdf y grows upwards
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let current = [];
  let lineY = sorted[0].y;
  let lineSize = sorted[0].size;

  for (const it of sorted) {
    if (Math.abs(it.y - lineY) > Math.max(2, lineSize * 0.45)) {
      lines.push({ items: current, y: lineY, size: lineSize });
      current = [];
      lineY = it.y;
      lineSize = it.size;
    }
    current.push(it);
    lineSize = Math.max(lineSize, it.size);
  }
  if (current.length) lines.push({ items: current, y: lineY, size: lineSize });

  const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 10;

  const out = [];
  let prevY = null;
  for (const line of lines) {
    const parts = line.items.sort((a, b) => a.x - b.x);
    let s = '';
    let lastEnd = null;
    for (const it of parts) {
      if (lastEnd !== null && it.x - lastEnd > it.size * 0.25 && !s.endsWith(' ')) s += ' ';
      s += it.str;
      lastEnd = it.x + it.w;
    }
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) continue;

    // big vertical gap or a bigger font usually means a new block / heading
    const gap = prevY === null ? 0 : prevY - line.y;
    if (prevY !== null && (gap > median * 2.2 || line.size > median * 1.25)) out.push('');
    out.push(s);
    prevY = line.y;
  }
  return out.join('\n');
}

// ---------------- DOCX ----------------

async function extractDocx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const xml = await readZipEntry(buf, 'word/document.xml');
  if (!xml) throw new Error('Could not find word/document.xml - is this a real .docx?');

  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const lines = [];

  for (const p of dom.getElementsByTagNameNS(W, 'p')) {
    let s = '';
    const walker = dom.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.namespaceURI === W) {
        if (node.localName === 't') s += node.textContent;
        else if (node.localName === 'tab') s += ' ';
        else if (node.localName === 'br') s += '\n';
      }
      node = walker.nextNode();
    }
    const isListItem = p.getElementsByTagNameNS(W, 'numPr').length > 0;
    s = s.trim();
    if (s) lines.push(isListItem ? '• ' + s : s);
  }
  return { text: lines.join('\n'), meta: { pages: null, columns: 1 } };
}

// Minimal zip reader: find the central directory, look up one entry, inflate it.
async function readZipEntry(buf, wanted) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name === wanted) {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      if (method === 0) return decoder.decode(raw);
      if (method !== 8) throw new Error('Unsupported zip compression');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
