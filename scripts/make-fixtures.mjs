// Generates the test fixtures in tests/fixtures/. Run with `npm run fixtures`.
// Everything here is synthetic; no third-party documents are used.
// The encrypted PDFs are produced separately by scripts/make-encrypted-fixtures.py (pypdf).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

const out = path.resolve('tests/fixtures');
mkdirSync(out, { recursive: true });
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('PageSail fixtures');
  doc.setCreator('PageSail fixtures');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

async function save(doc, name) {
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(path.join(out, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}

// ---------------------------------------------------------------------------
// multipage.pdf — 4 pages with different sizes, a /Rotate page and a CropBox page.
// Each page has a 60 pt colour marker at its *displayed* top-left corner.
{
  const doc = await newDoc('PageSail multipage fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // p1: A4 portrait, red marker
  let p = doc.addPage([595, 842]);
  p.drawRectangle({ x: 0, y: 782, width: 60, height: 60, color: rgb(1, 0, 0) });
  p.drawText('FIXTURE PAGE 1', { x: 100, y: 700, size: 24, font });
  // p2: landscape, green marker
  p = doc.addPage([842, 595]);
  p.drawRectangle({ x: 0, y: 535, width: 60, height: 60, color: rgb(0, 0.8, 0) });
  p.drawText('FIXTURE PAGE 2', { x: 100, y: 400, size: 24, font });
  // p3: A4 portrait with /Rotate 90. The marker is drawn at the *user space* top-left,
  // which a viewer shows at the top-right after rotating the page 90° clockwise.
  p = doc.addPage([595, 842]);
  p.drawRectangle({ x: 0, y: 782, width: 60, height: 60, color: rgb(0, 0, 1) });
  p.drawText('FIXTURE PAGE 3', { x: 100, y: 700, size: 24, font });
  p.setRotation(degrees(90));
  // p4: MediaBox 600x800 with CropBox [100 150 500 650]; magenta marker at the crop's
  // top-left; an orange band outside the crop must never be visible.
  p = doc.addPage([600, 800]);
  p.drawRectangle({ x: 0, y: 0, width: 100, height: 800, color: rgb(1, 0.6, 0) });
  p.drawRectangle({ x: 100, y: 590, width: 60, height: 60, color: rgb(1, 0, 1) });
  p.drawText('FIXTURE PAGE 4', { x: 180, y: 400, size: 24, font });
  p.setCropBox(100, 150, 400, 500);
  await save(doc, 'multipage.pdf');
}

// ---------------------------------------------------------------------------
// annotate-targets.pdf — pages for coordinate tests: rotations 0/90/180/270, a rotated
// page with a CropBox offset, and a page whose content leaves the CTM modified.
{
  const doc = await newDoc('PageSail annotation targets');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rot of [0, 90, 180, 270]) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Original text rotate ${rot}`, { x: 72, y: 760, size: 18, font });
    p.setRotation(degrees(rot));
  }
  {
    const p = doc.addPage([600, 800]);
    p.drawText('Original text cropped rotated', { x: 80, y: 600, size: 18, font });
    p.setCropBox(50, 100, 400, 600);
    p.setRotation(degrees(90));
  }
  {
    const p = doc.addPage([595, 842]);
    p.drawText('Original text unbalanced CTM', { x: 72, y: 760, size: 18, font });
    // Leave a scaling CTM active at the end of the original content stream.
    const extra = doc.context.flateStream('2 0 0 2 30 30 cm\n');
    const ref = doc.context.register(extra);
    p.node.addContentStream(ref);
  }
  await save(doc, 'annotate-targets.pdf');
}

// ---------------------------------------------------------------------------
// docA.pdf / docB.pdf — merge & page-operation sources. docA has a link on page 1 that
// points to page 3 and a sticky note on page 2, so that page copies would drag other
// pages along if cross-page references were not cut.
{
  const doc = await newDoc('Doc A');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [];
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`DOC A PAGE ${i}`, { x: 72, y: 700, size: 32, font });
    if (i === 3) p.drawText('SECRETPAGEA3', { x: 72, y: 600, size: 18, font });
    pages.push(p);
  }
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [72, 690, 300, 740],
    Border: [0, 0, 0],
    Dest: [pages[2].ref, 'XYZ', null, null, null],
    P: pages[0].ref,
  });
  pages[0].node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));
  const note = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [400, 700, 420, 720],
    Contents: PDFString.of('Sticky note on page 2'),
    P: pages[1].ref,
  });
  pages[1].node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(note)]));
  await save(doc, 'docA.pdf');
}
{
  const doc = await newDoc('Doc B');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const p = doc.addPage([842, 595]);
    p.drawText(`DOC B PAGE ${i}`, { x: 72, y: 450, size: 32, font });
    if (i === 2) p.setRotation(degrees(180));
  }
  await save(doc, 'docB.pdf');
}

// ---------------------------------------------------------------------------
// cjk-cmap.pdf — non-embedded CJK font with a predefined CMap. pdf.js must fetch
// cmaps/UniGB-UCS2-H.bcmap from the site to decode it.
{
  const doc = await newDoc('CJK CMap fixture');
  const page = doc.addPage([400, 200]);
  const ctx = doc.context;
  const descriptor = ctx.obj({
    Type: 'FontDescriptor',
    FontName: 'STSong-Light',
    Flags: 6,
    FontBBox: [-25, -254, 1000, 880],
    ItalicAngle: 0,
    Ascent: 880,
    Descent: -120,
    CapHeight: 880,
    StemV: 93,
  });
  const cid = ctx.obj({
    Type: 'Font',
    Subtype: 'CIDFontType0',
    BaseFont: 'STSong-Light',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('GB1'), Supplement: 4 },
    FontDescriptor: ctx.register(descriptor),
    DW: 1000,
  });
  const font = ctx.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'STSong-Light',
    Encoding: 'UniGB-UCS2-H',
    DescendantFonts: PDFArray.withContext(ctx),
  });
  font.lookup(PDFName.of('DescendantFonts'), PDFArray).push(ctx.register(cid));
  const fontRef = ctx.register(font);
  const key = page.node.newFontDictionary('F', fontRef);
  const stream = ctx.flateStream(`BT ${key.toString()} 36 Tf 40 100 Td <4E2D65876D4B8BD5> Tj ET\n`);
  page.node.addContentStream(ctx.register(stream));
  await save(doc, 'cjk-cmap.pdf');
}

// ---------------------------------------------------------------------------
// Broken / unsupported inputs
writeFileSync(path.join(out, 'empty.pdf'), new Uint8Array(0));
writeFileSync(path.join(out, 'corrupt.pdf'), Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nthis is not a valid pdf body\n'));
console.log('empty.pdf, corrupt.pdf');

// ---------------------------------------------------------------------------
// Images (generated with @napi-rs/canvas)
function png(name, w, h, draw) {
  const c = createCanvas(w, h);
  draw(c.getContext('2d'));
  writeFileSync(path.join(out, name), c.toBuffer('image/png'));
  console.log(name);
}
function jpeg(w, h, draw) {
  const c = createCanvas(w, h);
  draw(c.getContext('2d'));
  return c.toBuffer('image/jpeg', 95);
}

png('red-wide.png', 240, 120, (g) => {
  g.fillStyle = '#ff0000';
  g.fillRect(0, 0, 240, 120);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 30, 30);
});
png('transparent.png', 200, 200, (g) => {
  g.clearRect(0, 0, 200, 200);
  g.fillStyle = '#0000ff';
  g.fillRect(100, 0, 100, 200);
  g.fillStyle = '#ffff00';
  g.fillRect(150, 150, 50, 50);
});
writeFileSync(
  path.join(out, 'green-tall.jpg'),
  jpeg(120, 240, (g) => {
    g.fillStyle = '#00c000';
    g.fillRect(0, 0, 120, 240);
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 30, 30);
  }),
);
console.log('green-tall.jpg');

// JPEG stored as 160x80 with a black marker at the *stored* top-left and EXIF
// orientation 6 (rotate 90° CW to display): displayed 80x160 with the marker top-right.
{
  const base = jpeg(160, 80, (g) => {
    g.fillStyle = '#ff8800';
    g.fillRect(0, 0, 160, 80);
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 30, 30);
  });
  // Minimal big-endian TIFF/EXIF block with one IFD entry: Orientation (0x0112) = 6.
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  const withExif = Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
  writeFileSync(path.join(out, 'exif-rotate6.jpg'), withExif);
  console.log('exif-rotate6.jpg');
}
{
  const c = createCanvas(64, 64);
  c.getContext('2d').fillRect(0, 0, 64, 64);
  writeFileSync(path.join(out, 'image.webp'), c.toBuffer('image/webp'));
  console.log('image.webp');
}
// A PNG with a .pdf extension (wrong extension must not fool the app).
{
  const c = createCanvas(10, 10);
  writeFileSync(path.join(out, 'image-named.pdf'), c.toBuffer('image/png'));
  console.log('image-named.pdf');
}
