const axios = require("axios");
const { convert: htmlToText } = require("html-to-text");

// ─── HTTP Client ──────────────────────────────────────────────
const http = axios.create({
  timeout: 30000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    Referer: "https://www.wattpad.com/",
  },
  validateStatus: (status) => status >= 200 && status < 500,
});

// ─── Helpers ──────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error("Scraper error:", err.message);
    return fallback;
  }
}

async function requestWithRetry(configFn, retries = 2, delayMs = 800) {
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await configFn();

      if (resp.status >= 400) {
        const body =
          typeof resp.data === "string"
            ? resp.data.slice(0, 200)
            : JSON.stringify(resp.data).slice(0, 200);

        throw new Error(`HTTP ${resp.status} al consultar Wattpad: ${body}`);
      }

      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(delayMs * (attempt + 1));
        continue;
      }
    }
  }

  throw lastErr;
}

function extractStoryId(url) {
  const m = String(url).match(/\/story\/(\d+)/);
  if (!m) throw new Error("No se encontró ID de historia en la URL.");
  return m[1];
}

function cleanHtml(html) {
  if (!html || typeof html !== "string") return "";

  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      {
        selector: "p",
        options: { leadingLineBreaks: 1, trailingLineBreaks: 1 },
      },
    ],
  }).trim();
}

/**
 * Descarga una imagen y la retorna como buffer + mime type.
 * Retorna null si falla.
 */
async function downloadImage(url) {
  try {
    const cleanUrl = String(url).split("?")[0];

    const resp = await requestWithRetry(
      () => http.get(cleanUrl, { responseType: "arraybuffer", timeout: 10000 }),
      1,
      500
    );

    const mimeType = resp.headers["content-type"] || "image/jpeg";
    if (!String(mimeType).startsWith("image/")) return null;

    return {
      buffer: Buffer.from(resp.data),
      mimeType: mimeType.split(";")[0].trim(),
      ext: mimeType.includes("png")
        ? "png"
        : mimeType.includes("gif")
        ? "gif"
        : "jpg",
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
  return safe(async () => {
    const id = extractStoryId(url);

    const resp = await requestWithRetry(() =>
      http.get(`https://www.wattpad.com/api/v3/stories/${id}`, {
        params: {
          fields:
            "id,title,mainCategory,tags,description,cover,user(name),numParts,completed",
        },
      })
    );

    const data = resp.data;

    if (!data || typeof data !== "object") {
      throw new Error("Respuesta inválida de Wattpad.");
    }

    return {
      id: data.id,
      title: data.title,
      author: data.user?.name || "Desconocido",
      description: data.description || "",
      cover: data.cover || null,
      category: data.mainCategory || null,
      tags: data.tags || [],
      chaptersCount: data.numParts || 0,
      completed: data.completed || false,
      url,
    };
  }, {
    error: true,
    detail: "No se pudo obtener la metadata de Wattpad.",
    id: null,
    title: "Error al cargar historia",
    author: "Desconocido",
    description: "",
    cover: null,
    category: null,
    tags: [],
    chaptersCount: 0,
    completed: false,
    url,
  });
}

/**
 * Lista ligera de capítulos: sólo id, title, index, length.
 * Usado por el endpoint GET /api/chapters para la UI.
 */
async function getChapterList(url) {
  return safe(async () => {
    const id = extractStoryId(url);

    const resp = await requestWithRetry(() =>
      http.get(`https://www.wattpad.com/api/v3/stories/${id}/parts`, {
        params: { fields: "id,title,length", limit: 500, offset: 0 },
      })
    );

    const data = resp.data;
    const parts = data?.pages || data?.parts || [];

    if (!Array.isArray(parts)) {
      throw new Error("Respuesta inválida de Wattpad.");
    }

    return parts.map((p, i) => ({
      index: i + 1,
      id: p.id,
      title: p.title || `Capítulo ${i + 1}`,
      length: p.length || 0,
    }));
  }, {
    error: true,
    detail: "No se pudo obtener la lista de capítulos.",
    chapters: [],
  });
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

  if (info?.error) {
    throw new Error(info.detail || "No se pudo obtener la información de la historia.");
  }

  if (allParts?.error) {
    throw new Error(allParts.detail || "No se pudo obtener la lista de capítulos.");
  }

  if (!allParts.length) throw new Error("No se encontraron capítulos.");

  const partsToFetch = chapterIndices
    ? allParts.filter((p) => chapterIndices.includes(p.index))
    : allParts;

  if (!partsToFetch.length) {
    throw new Error("Ningún capítulo seleccionado es válido.");
  }

  const chapters = [];

  for (let i = 0; i < partsToFetch.length; i++) {
    const part = partsToFetch[i];

    try {
      const resp = await requestWithRetry(() =>
        http.get("https://www.wattpad.com/apiv2/storytext", {
          params: { id: part.id },
        })
      );

      const html = resp.data;
      const htmlStr = typeof html === "string" ? html : String(html || "");
      let text = cleanHtml(htmlStr);

      if (!text) {
        text = "[Contenido no disponible]";
      }

      let images = [];
      if (includeImages) {
        const imgUrls = extractImageUrls(htmlStr);
        const downloads = await Promise.all(imgUrls.map(downloadImage));
        images = downloads
          .map((d, idx) => (d ? { ...d, id: `ch${part.index}_img${idx}` } : null))
          .filter(Boolean);

        if (images.length) {
          console.log(`  ↳ Cap ${part.index}: ${images.length} imágenes`);
        }
      }

      chapters.push({
        index: part.index,
        title: part.title,
        html: htmlStr,
        text,
        images,
      });
    } catch (err) {
      console.warn(`  ⚠ Cap ${part.index}: ${err.message}`);
      chapters.push({
        index: part.index,
        title: part.title,
        html: "",
        text: "[No disponible]",
        images: [],
      });
    }

    if (i < partsToFetch.length - 1) {
      await sleep(300 + Math.random() * 350);
    }
  }

  return {
    id: info.id,
    title: info.title,
    author: info.author,
    description: info.description,
    cover: info.cover,
    url,
    chapters,
  };
}

module.exports = { getStoryInfo, getChapterList, getFullStory };
