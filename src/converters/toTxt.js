async function toTxt(story) {
  const lines   = [];
  const sep     = "═".repeat(60);
  const thinSep = "─".repeat(60);

  lines.push(sep);
  lines.push(center(story.title, 60));
  lines.push(center(`por ${story.author}`, 60));
  lines.push(sep);

  if (story.description) {
    lines.push("", "DESCRIPCIÓN", thinSep, story.description.trim(), "");
  }

  lines.push(`Capítulos incluidos: ${story.chapters.length}`);
  lines.push(`Fuente: ${story.url}`, "", sep, "");

  for (const ch of story.chapters) {
    lines.push("", thinSep, `Capítulo ${ch.index}: ${ch.title}`, thinSep, "");

    // Intercalar texto e imágenes según posición en el HTML
    if (ch.images && ch.images.length > 0) {
      lines.push(ch.text);
      lines.push("");
      for (const img of ch.images) {
        lines.push(`[📷 Imagen: ${img.id}.${img.ext}]`);
      }
    } else {
      lines.push(ch.text);
    }
    lines.push("");
  }

  lines.push(sep, center("— Fin —", 60), sep);
  return Buffer.from(lines.join("\n"), "utf-8");
}

function center(text, width) {
  if (text.length >= width) return text;
  return " ".repeat(Math.floor((width - text.length) / 2)) + text;
}

module.exports = toTxt;
