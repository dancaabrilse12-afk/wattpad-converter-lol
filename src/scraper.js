/**
 * scraper.js — WattFetch
 * Usa la API v4 oficial de Wattpad para metadata y /apiv2/storytext para texto.
 * Incluye: User-Agent rotativo, headers de navegador real, reintentos y delays.
 */

const axios   = require("axios");
const cheerio = require("cheerio");
const { convert } = require("html-to-text");

// ── User-Agents de navegadores reales ──────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

const delay     = (ms) => new Promise((r) => setTimeout(r, ms));
const randUA    = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const randDelay = (min = 700, max = 1400) => delay(min + Math.random() * (max - min));

function extractStoryId(url) {
  const m = String(url).match(/\/story\/(\d+)/);
  return m ? m[1] : null;
}

// ── Clase principal ─────────────────────────────────────────────
class WattpadScraper {
  constructor() {
    this.http = axios.create({
      timeout: 28000,
      decompress: true,
      // No lanzar error en 4xx/5xx para manejarlos manualmente
      validateStatus: () => true,
    });
  }

  /** Headers que imitan un navegador real */
  _headers(extra = {}) {
    return {
      "User-Agent"               : randUA(),
      "Accept-Language"          : "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding"          : "gzip, deflate, br",
      "Cache-Control"            : "no-cache",
      "Pragma"                   : "no-cache",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Site"           : "same-origin",
      "Sec-Fetch-Mode"           : "navigate",
      "Sec-Fetch-Dest"           : "document",
      "Referer"                  : "https://www.wattpad.com/",
      ...extra,
    };
  }

  /** GET con reintentos y backoff exponencial */
  async _get(url, headerExtra = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
      let res;
      try {
        res = await this.http.get(url, { headers: this._headers(headerExtra) });
      } catch (netErr) {
        // Error de red (timeout, DNS, etc.)
        if (i < retries - 1) { await delay((i + 1) * 2000); continue; }
        throw new Error(`Error de red: ${netErr.message}`);
      }

      const { status } = res;

      if (status === 200) return res;

      if (status === 429 || status === 503) {
        // Rate limit — esperar más tiempo
        const wait = (i + 1) * 4000;
        console.warn(`[scraper] Rate limit (${status}) en ${url}. Esperando ${wait}ms…`);
        await delay(wait);
        continue;
      }

      if (status === 404) {
        const e = new Error("NOT_FOUND"); e.code = "NOT_FOUND"; throw e;
      }
      if (status === 403 || status === 401) {
        const e = new Error("PRIVATE");   e.code = "PRIVATE";   throw e;
      }
      if (status >= 400) {
        if (i < retries - 1) { await delay((i + 1) * 1500); continue; }
        throw new Error(`HTTP ${status} en ${url}`);
      }
    }
    throw new Error(`Máximo de reintentos alcanzado: ${url}`);
  }

  // ── API pública ─────────────────────────────────────────────────

  /**
   * Obtiene metadata + lista de capítulos (sin texto).
   * Usa el endpoint oficial v4 — rápido y sin bloqueos.
   */
  async getStoryMetadata(url) {
    const storyId = extractStoryId(url);
    if (!storyId) {
      const e = new Error("URL inválida: no se encontró ID de historia");
      e.code = "INVALID_URL"; throw e;
    }

    const apiUrl =
      `https://www.wattpad.com/api/v4/stories/${storyId}` +
      `?fields=id,title,user(name),description,cover,numParts,language(name),tags,parts(id,title,url,wordCount)`;

    const res = await this._get(apiUrl, {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    });

    const d = res.data;

    // Validar que sea JSON con datos
    if (!d || typeof d !== "object" || !d.id) {
      throw new Error("Respuesta inesperada de Wattpad. Puede que la historia no exista.");
    }

    return {
      id         : String(d.id),
      url,
      title      : (d.title        || "Sin título").trim(),
      author     : (d.user?.name   || "Desconocido").trim(),
      description: (d.description  || "").trim(),
      cover      : d.cover         || "",
      lang       : d.language?.name || "es",
      chapters   : (d.parts || []).map((p, i) => ({
        id       : String(p.id),
        title    : (p.title || `Capítulo ${i + 1}`).trim(),
        url      : p.url
          ? (p.url.startsWith("http") ? p.url : `https://www.wattpad.com${p.url}`)
          : `https://www.wattpad.com/${p.id}`,
        wordCount: p.wordCount || 0,
        index    : i + 1,
      })),
    };
  }

  /**
   * Obtiene el texto de un capítulo dado su ID de parte.
   * Intenta primero /apiv2/storytext (más fiable), luego scrape directo.
   */
  async getChapterText(partId, chapterUrl) {
    // Método 1: Endpoint oficial de texto
    try {
      const res = await this._get(
        `https://www.wattpad.com/apiv2/storytext?id=${partId}`,
        {
          Accept  : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer : `https://www.wattpad.com/${partId}`,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
        }
      );
      const result = this._parseChapterHtml(res.data, partId);
      if (result.text && result.text.length > 50) return result;
    } catch (err) {
      if (err.code === "PRIVATE" || err.code === "NOT_FOUND") throw err;
      console.warn(`[scraper] storytext falló para ${partId}: ${err.message}`);
    }

    // Método 2: Scrape directo de la página del capítulo
    await randDelay(800, 1600);
    try {
      const res = await this._get(chapterUrl, {
        Accept  : "text/html,application/xhtml+xml",
        Referer : "https://www.wattpad.com/",
        "Sec-Fetch-Dest": "document",
      });
      const result = this._parseChapterHtml(res.data, partId);
      if (result.text && result.text.length > 10) return result;
    } catch (err) {
      console.warn(`[scraper] Scrape directo falló para ${chapterUrl}: ${err.message}`);
    }

    return { text: "[Contenido no disponible para este capítulo]", images: [] };
  }

  /** Parsea HTML de capítulo → { text, images[] } */
  _parseChapterHtml(html, partId) {
    if (!html || typeof html !== "string") return { text: "", images: [] };

    const $ = cheerio.load(html);

    // Eliminar ruido
    $("script, style, noscript, nav, header, footer, aside").remove();
    $("[class*='ad'], [class*='banner'], [class*='popup']").remove();

    // Extraer imágenes
    const images  = [];
    let   imgIdx  = 0;
    $("img[src], img[data-src]").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (!src || src.startsWith("data:") || !src.startsWith("http")) return;
      const rawExt = (src.split(".").pop().split(/[?#]/)[0] || "").toLowerCase();
      const ext    = ["jpg","jpeg","png","gif","webp"].includes(rawExt) ? rawExt : "jpg";
      images.push({
        id      : `img_${partId}_${imgIdx++}`,
        src,
        ext     : ext === "jpeg" ? "jpg" : ext,
        mimeType: ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg",
        buffer  : null,
      });
    });

    // Extraer texto de párrafos con data-p-id (estructura oficial Wattpad)
    const paras = [];
    $("p[data-p-id]").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t) paras.push(t);
    });

    // Fallback: cualquier <p>
    if (paras.length === 0) {
      $("p").each((_, el) => {
        const t = $(el).text().replace(/\s+/g, " ").trim();
        if (t && t.length > 5) paras.push(t);
      });
    }

    // Fallback: conversión genérica html-to-text
    const text = paras.length > 0
      ? paras.join("\n\n")
      : convert(html, {
          wordwrap: false,
          selectors: [
            { selector: "img",    format: "skip" },
            { selector: "a",      options: { ignoreHref: true } },
            { selector: "script", format: "skip" },
            { selector: "style",  format: "skip" },
          ],
        }).replace(/\n{3,}/g, "\n\n").trim();

    return { text, images };
  }

  /**
   * Obtiene historia completa con texto de todos (o los seleccionados) capítulos.
   * @param {string}   url         — URL de la historia
   * @param {string[]} selectedIds — IDs de partes a incluir (null = todos)
   */
  async getFullStory(url, selectedIds = null) {
    const meta = await this.getStoryMetadata(url);

    // Filtrar capítulos si se especificaron IDs
    const chapters = selectedIds && selectedIds.length > 0
      ? meta.chapters.filter((c) => selectedIds.includes(String(c.id)))
      : meta.chapters;

    console.log(`[scraper] Descargando ${chapters.length} capítulos de "${meta.title}"…`);

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      if (i > 0) await randDelay(700, 1300); // delay cortés entre requests

      console.log(`[scraper] Capítulo ${i + 1}/${chapters.length}: "${ch.title}"`);

      try {
        const { text, images } = await this.getChapterText(ch.id, ch.url);
        ch.text      = text;
        ch.images    = images;
        ch.wordCount = ch.wordCount || text.split(/\s+/).filter(Boolean).length;
      } catch (err) {
        if (err.code === "PRIVATE") throw err; // propagar errores críticos
        ch.text   = "[Error al cargar este capítulo]";
        ch.images = [];
        console.error(`[scraper] Error en capítulo ${ch.index}: ${err.message}`);
      }
    }

    return {
      ...meta,
      chapters,
      totalWords: chapters.reduce((s, c) => s + (c.wordCount || 0), 0),
    };
  }
}

module.exports = new WattpadScraper();
            
