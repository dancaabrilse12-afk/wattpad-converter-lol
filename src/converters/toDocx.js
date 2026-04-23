const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  HeadingLevel, AlignmentType, PageBreak, BorderStyle,
} = require("docx");

async function toDocx(story) {
  const children = [];

  // ── PORTADA ──────────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [new TextRun({ text: story.title, bold: true, size: 52, color: "1a1a2e" })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `por ${story.author}`, italics: true, size: 28, color: "e94560" })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 600 },
    })
  );

  if (story.description) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: story.description.trim(), italics: true, size: 22, color: "555555" })],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 200, after: 200 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: "e94560", space: 12 } },
        indent: { left: 360 },
      })
    );
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: `${story.chapters.length} capítulos · ${story.url}`, size: 18, color: "999999" })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 0 },
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

  // ── CAPÍTULOS ─────────────────────────────────────────────────
  for (const ch of story.chapters) {
    // Encabezado
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `CAPÍTULO ${ch.index}`, size: 16, color: "999999", allCaps: true, bold: true })],
        spacing: { before: 0, after: 80 },
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: ch.title, size: 30, bold: true, color: "16213e" })],
        spacing: { before: 80, after: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "e94560", space: 4 } },
      })
    );

    // Cuerpo con imágenes
    const paragraphs = (ch.text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const imgCount   = ch.images ? ch.images.length : 0;
    const imgEvery   = imgCount > 0 ? Math.max(1, Math.floor(paragraphs.length / imgCount)) : Infinity;
    let imgIdx       = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: paragraphs[i].replace(/\n/g, " "), size: 22, color: "2d2d2d" })],
          alignment: AlignmentType.JUSTIFIED,
          spacing: { before: 0, after: 160 },
          indent: i > 0 ? { firstLine: 480 } : {},
        })
      );

      // Insertar imagen
      if (imgIdx < imgCount && (i + 1) % imgEvery === 0) {
        const img = ch.images[imgIdx++];
        const imgPara = buildImagePara(img);
        if (imgPara) children.push(imgPara);
      }
    }

    // Imágenes restantes
    while (imgIdx < imgCount) {
      const imgPara = buildImagePara(ch.images[imgIdx++]);
      if (imgPara) children.push(imgPara);
    }

    // Page break entre capítulos
    if (ch.index < story.chapters.length) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  // ── PIE ───────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [new TextRun({ text: "— Fin —", bold: true, size: 24, color: "e94560" })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 800, after: 200 },
    })
  );

  // ── Documento ─────────────────────────────────────────────────
  const doc = new Document({
    creator    : "Wattpad Converter API",
    title      : story.title,
    description: story.description || "",
    styles: {
      default: { document: { run: { font: "Georgia", size: 22 } } },
      paragraphStyles: [{
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Georgia", color: "16213e" },
        paragraph: { spacing: { before: 80, after: 240 }, outlineLevel: 1 },
      }],
    },
    sections: [{
      properties: {
        page: {
          size  : { width: 11906, height: 16838 }, // A5
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

/**
 * Genera un Paragraph con ImageRun desde el objeto imagen del scraper.
 * Retorna null si el buffer es inválido.
 */
function buildImagePara(img) {
  if (!img || !img.buffer || img.buffer.length < 100) return null;
  try {
    const type = img.ext === "png" ? "png" : img.ext === "gif" ? "gif" : "jpg";
    // Tamaño máximo: 9026 EMU = ~6.27" → usamos 5" = 4572000 EMU
    // Relación 4:3 por defecto si no tenemos dimensiones
    return new Paragraph({
      children: [
        new ImageRun({
          data: img.buffer,
          type,
          transformation: { width: 350, height: 233 }, // pts
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 120 },
    });
  } catch {
    return new Paragraph({
      children: [new TextRun({ text: "[imagen no disponible]", italics: true, color: "aaaaaa", size: 18 })],
      alignment: AlignmentType.CENTER,
    });
  }
}

module.exports = toDocx;
          
