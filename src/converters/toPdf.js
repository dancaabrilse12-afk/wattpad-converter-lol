const PDFDocument = require("pdfkit");

const C = {
  title  : "#1a1a2e",
  author : "#e94560",
  chapter: "#16213e",
  body   : "#2d2d2d",
  meta   : "#999999",
  line   : "#e94560",
};

function toPdf(story) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size   : "A5",
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info   : {
        Title  : story.title,
        Author : story.author,
        Creator: "Wattpad Converter API",
      },
      bufferPages: true,
    });

    doc.on("data",  (c) => chunks.push(c));
    doc.on("end",   ()  => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = doc.page.width;
    const CW = PW - 120; // ancho de contenido
    const ML = 60;       // margen izquierdo

    // ── PORTADA ─────────────────────────────────────────────
    const midY = doc.page.height / 2 - 100;

    doc.moveTo(ML, midY - 20).lineTo(PW - ML, midY - 20)
       .strokeColor(C.line).lineWidth(2).stroke();

    doc.font("Helvetica-Bold").fontSize(22).fillColor(C.title)
       .text(story.title, ML, midY, { width: CW, align: "center" });

    doc.font("Helvetica-Oblique").fontSize(14).fillColor(C.author)
       .text(`por ${story.author}`, ML, doc.y + 8, { width: CW, align: "center" });

    const lineY = doc.y + 14;
    doc.moveTo(ML, lineY).lineTo(PW - ML, lineY)
       .strokeColor(C.line).lineWidth(2).stroke();

    doc.font("Helvetica").fontSize(9).fillColor(C.meta)
       .text(`${story.chapters.length} capítulos · Wattpad`, ML, lineY + 12, { width: CW, align: "center" });

    if (story.description) {
      doc.font("Helvetica").fontSize(10).fillColor(C.body)
         .text(story.description.slice(0, 400).trim(), ML, doc.y + 30, {
           width: CW, align: "justify", lineGap: 3,
         });
    }

    // ── CAPÍTULOS ────────────────────────────────────────────
    for (const ch of story.chapters) {
      doc.addPage();

      // Encabezado
      doc.font("Helvetica-Bold").fontSize(7).fillColor(C.meta)
         .text(`CAPÍTULO ${ch.index}`);

      doc.font("Helvetica-Bold").fontSize(16).fillColor(C.chapter)
         .text(ch.title, { lineGap: 2 });

      doc.moveDown(0.3);
      const sy = doc.y;
      doc.moveTo(ML, sy).lineTo(PW - ML, sy).strokeColor(C.line).lineWidth(0.8).stroke();
      doc.moveDown(0.8);

      // Texto del capítulo con imágenes intercaladas
      if (ch.images && ch.images.length > 0) {
        renderChapterWithImages(doc, ch, CW, ML, C);
      } else {
        doc.font("Helvetica").fontSize(10.5).fillColor(C.body)
           .text(ch.text || "[Sin contenido]", { align: "justify", lineGap: 4, paragraphGap: 8 });
      }
    }

    // Numeración de páginas
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8).fillColor(C.meta)
         .text(`${i + 1}`, 0, doc.page.height - 40, { align: "center", width: PW });
    }

    doc.end();
  });
}

/**
 * Renderiza texto + imágenes de un capítulo en el PDF.
 * Intenta colocar las imágenes en el lugar donde aparecen en el HTML.
 */
function renderChapterWithImages(doc, ch, contentWidth, marginLeft, colors) {
  // Dividimos el texto en párrafos y alternamos con imágenes
  const paragraphs = (ch.text || "").split(/\n{2,}/).filter((p) => p.trim());
  const imgCount   = ch.images.length;
  // Distribuir imágenes de forma equitativa entre los párrafos
  const imgEvery   = imgCount > 0 ? Math.max(1, Math.floor(paragraphs.length / imgCount)) : Infinity;

  let imgIndex = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const clean = paragraphs[i].trim().replace(/\n/g, " ");
    doc.font("Helvetica").fontSize(10.5).fillColor(colors.body)
       .text(clean, { align: "justify", lineGap: 4, paragraphGap: 6 });

    // ¿Insertar imagen aquí?
    if (imgIndex < imgCount && (i + 1) % imgEvery === 0) {
      const img = ch.images[imgIndex++];
      try {
        // Calcular tamaño máximo respetando el ancho del contenido
        const maxW = contentWidth;
        const maxH = 200;
        doc.moveDown(0.5);
        doc.image(img.buffer, marginLeft, doc.y, {
          fit    : [maxW, maxH],
          align  : "center",
          valign : "center",
        });
        doc.moveDown(0.5);
      } catch {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(colors.meta)
           .text("[imagen no disponible]", { align: "center" });
      }
    }
  }

  // Imágenes restantes al final
  while (imgIndex < imgCount) {
    const img = ch.images[imgIndex++];
    try {
      doc.moveDown(0.5);
      doc.image(img.buffer, marginLeft, doc.y, {
        fit   : [contentWidth, 200],
        align : "center",
        valign: "center",
      });
      doc.moveDown(0.5);
    } catch { /* skip */ }
  }
}

module.exports = toPdf;
