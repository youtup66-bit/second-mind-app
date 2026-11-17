// بناء ملف Word (.docx) داخل المتصفح دون مكتبات خارجية: ملف docx هو أرشيف ZIP فيه أجزاء XML.
// كل الفقرات من اليمين إلى اليسار، والصور تُعاد ترميزها JPEG (تعمل في كل إصدارات Word).
import { createZip } from './zip.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const EMU_PER_PX = 9525;
const MAX_IMG_EMU = 5029200; // 5.5 إنش عرضاً

const STYLE = {
  title: { size: 36, bold: true, color: '1F4E79', before: 0, after: 240 },
  h: { size: 28, bold: true, color: '1F4E79', before: 240, after: 120 },
  h2: { size: 24, bold: true, color: '404040', before: 200, after: 80 },
  meta: { size: 18, color: '666666', before: 0, after: 60 },
  p: { size: 22, before: 0, after: 100 },
};

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function textPara(text, s) {
  const b = s.bold ? '<w:b/>' : '';
  const c = s.color ? `<w:color w:val="${s.color}"/>` : '';
  return `<w:p><w:pPr><w:bidi/><w:spacing w:before="${s.before}" w:after="${s.after}"/></w:pPr>`
    + `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${b}${c}`
    + `<w:sz w:val="${s.size}"/><w:szCs w:val="${s.size}"/><w:rtl/></w:rPr>`
    + `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

// يحوّل أي صورة إلى JPEG ويعيد بياناتها وأبعادها
async function toJpeg(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('تعذّر تجهيز الصورة'))), 'image/jpeg', 0.85));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

function imagePara(rid, id, w, h) {
  let cx = w * EMU_PER_PX, cy = h * EMU_PER_PX;
  if (cx > MAX_IMG_EMU) { cy = Math.round(cy * MAX_IMG_EMU / cx); cx = MAX_IMG_EMU; }
  return `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:drawing>`
    + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="صورة ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>`
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="صورة ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// blocks: [{ t: 'title'|'h'|'h2'|'meta'|'p', text }] أو [{ t: 'img', dataUrl }]
export async function buildDocx(blocks) {
  const files = [];
  const rels = [];
  let body = '';
  let imgN = 0;
  for (const b of blocks) {
    if (b.t === 'img') {
      try {
        const { bytes, w, h } = await toJpeg(b.dataUrl);
        imgN++;
        const rid = `rIdImg${imgN}`;
        files.push({ name: `word/media/image${imgN}.jpeg`, data: bytes });
        rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${imgN}.jpeg"/>`);
        body += imagePara(rid, imgN, w, h);
      } catch { /* صورة تالفة: نتجاوزها */ }
      continue;
    }
    const s = STYLE[b.t] || STYLE.p;
    for (const line of String(b.text ?? '').split('\n')) body += textPara(line, s);
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document ${NS}><w:body>${body}`
    + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`
    + `</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="jpeg" ContentType="image/jpeg"/>`
    + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
    + `</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
    + `</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;

  const zip = await createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...files,
  ]);
  return new Blob([zip], { type: DOCX_MIME });
}
