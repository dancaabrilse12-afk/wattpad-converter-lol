const axios = require("axios");
const { convert: htmlToText } = require("html-to-text");

// ─── HTTP Client ──────────────────────────────────────────────
const http = axios.create({
  timeout: 30000,
  headers: {
    "User-Agent" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept"     : "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    "Referer"    : "https://www.wattpad.com/",
  },
});

// ─── Helpers ──────────────────────────────────────────────────
function extractStoryId(url) {
  const m = url.match(/\/story\/(\d+)/);
  if (!m) throw new Error("No se encontró ID de historia en la URL.");
  return m[1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanHtml(html) {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "a",   options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "p",   options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
    ],
  }).trim();
}

/**
 * Descarga una imagen y la retorna como buffer + mime type.
 * Retorna null si falla (no queremos que un error de imagen detenga todo).
 */
async function downloadImage(url) {
  try {
    // Wattpad sirve imágenes con parámetros; nos quedamos con la URL base
    const cleanUrl = url.split("?")[0];
    const resp = await http.get(cleanUrl, { responseType: "arraybuffer", timeout: 10000 });
    const mimeType = resp.headers["content-type"] || "image/jpeg";
    // Solo aceptamos imágenes conocidas
    if (!mimeType.startsWith("image/")) return null;
    return {
      buffer  : Buffer.from(resp.data),
      mimeType: mimeType.split(";")[0].trim(),
      ext     : mimeType.includes("png") ? "png" : mimeType.includes("gif") ? "gif" : "jpg",
    };
  } catch {
    return null;
  }
}

/**
 * Extrae src de todas las <img> en un HTML.
 */
function extractImageUrls(html) {
  const urls = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (src && src.startsWith("http")) urls.push(src);
  }
  return [...new Set(urls)];
}

// ─── Exports ──────────────────────────────────────────────────

/**
 * Metadata de la historia (sin capítulos).
 */
async function getStoryInfo(url) {
  const id = extractStoryId(url);
  const { data } = await http.get(`https://www.wattpad.com/api/v3/stories/${id}`, {
    params: { fields: "id,title,mainCategory,tags,description,cover,user(name),numParts,completed" },
  });
  return {
    id         : data.id,
    title      : data.title,
    author     : data.user?.name || "Desconocido",
    description: data.description || "",
    cover      : data.cover || null,
    category   : data.mainCategory || null,
    tags       : data.tags || [],
    chaptersCount: data.numParts || 0,
    completed  : data.completed || false,
    url,
  };
}

/**
 * Lista ligera de capítulos: sólo id, title, index, length.
 * Usado por el endpoint GET /api/chapters para la UI.
 */
async function getChapterList(url) {
  const id = extractStoryId(url);
  const { data } = await http.get(`https://www.wattpad.com/api/v3/stories/${id}/parts`, {
    params: { fields: "id,title,length", limit: 500, offset: 0 },
  });
  const parts = data.pages || [];
  return parts.map((p, i) => ({
    index : i + 1,
    id    : p.id,
    title : p.title || `Capítulo ${i + 1}`,
    length: p.length || 0,
  }));
}

/**
 * Historia completa con contenido de capítulos.
 * @param {string} url
 * @param {{ chapterIndices?: number[]|null, includeImages?: boolean }} opts
 */
async function getFullStory(url, opts = {}) {
  const { chapterIndices = null, includeImages = false } = opts;

  const [info, allParts] = await Promise.all([
    getStoryInfo(url),
    getChapterList(url),
  ]);

  if (!allParts.length) throw new Error("No se encontraron capítulos.");

  // Filtra los capítulos solicitados (por índice 1-based)
  const partsToFetch = chapterIndices
    ? allParts.filter((p) => chapterIndices.includes(p.index))
    : allParts;

  if (!partsToFetch.length) throw new Error("Ningún capítulo seleccionado es válido.");

  // Descarga contenido
  const chapters = [];
  for (let i = 0; i < partsToFetch.length; i++) {
    const part = partsToFetch[i];
    try {
      const { data: html } = await http.get("https://www.wattpad.com/apiv2/storytext", {
        params: { id: part.id },
      });
      const htmlStr = typeof html === "string" ? html : String(html);
      const text    = cleanHtml(htmlStr);

      // Descarga imágenes si se solicitó
      let images = [];
      if (includeImages) {
        const imgUrls = extractImageUrls(htmlStr);
        const downloads = await Promise.all(imgUrls.map(downloadImage));
        images = downloads
          .map((d, idx) => d ? { ...d, id: `ch${part.index}_img${idx}` } : null)
          .filter(Boolean);
        if (images.length) console.log(`  ↳ Cap ${part.index}: ${images.length} imágenes`);
      }

      chapters.push({
        index : part.index,
        title : part.title,
        html  : htmlStr,
        text,
        images,
      });
    } catch (err) {
      console.warn(`  ⚠ Cap ${part.index}: ${err.message}`);
      chapters.push({ index: part.index, title: part.title, html: "", text: "[No disponible]", images: [] });
    }

    if (i < partsToFetch.length - 1) await sleep(300 + Math.random() * 350);
  }

  return {
    id         : info.id,
    title      : info.title,
    author     : info.author,
    description: info.description,
    cover      : info.cover,
    url,
    chapters,
  };
}

module.exports = { getStoryInfo, getChapterList, getFullStory };
