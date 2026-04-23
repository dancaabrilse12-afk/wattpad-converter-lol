const axios = require("axios");
const cheerio = require("cheerio");
const { convert: htmlToText } = require("html-to-text");
const fs = require("fs");
const path = require("path");

class WattpadScraper {
  constructor() {
    this.cacheDir = path.join(__dirname, "../.cache");
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir);
    
    this.client = axios.create({
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      }
    });
  }

  // --- SISTEMA DE CACHÉ PERSISTENTE ---
  _getCache(id) {
    const p = path.join(this.cacheDir, `${id}.json`);
    if (fs.existsSync(p)) {
      const { data, expire } = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (Date.now() < expire) return data;
    }
    return null;
  }

  _setCache(id, data, ttlHours = 12) {
    const p = path.join(this.cacheDir, `${id}.json`);
    const payload = { data, expire: Date.now() + (ttlHours * 60 * 60 * 1000) };
    fs.writeFileSync(p, JSON.stringify(payload));
  }

  // --- EXTRACCIÓN DE METADATA ---
  async getStoryMetadata(url) {
    try {
      const { data: html } = await this.client.get(url);
      const $ = cheerio.load(html);

      // Selectores Semánticos (Buscan etiquetas, no clases)
      const title = $("h1").first().text().trim() || "Historia de Wattpad";
      const author = $('a[href*="/user/"]').first().text().trim() || "Autor Desconocido";
      const description = $('div[aria-label="Story description"]').text().trim() || $(".description-text").text().trim();
      const cover = $('.story-cover img').attr('src') || $('meta[property="og:image"]').attr('content');

      const chapters = [];
      // Buscamos enlaces que sigan el patrón de "partes" de Wattpad
      $('a[href*="/story/"]').each((i, el) => {
        const href = $(el).attr("href");
        const name = $(el).text().trim();
        if (href && name && href.includes("-")) {
          chapters.push({
            index: i + 1,
            title: name,
            url: href.startsWith("http") ? href : `https://www.wattpad.com${href}`,
            id: href.split("/")[2]?.split("-")[0] || Math.random().toString(36).slice(2)
          });
        }
      });

      // Limpiar duplicados de navegación
      const uniqueChapters = Array.from(new Map(chapters.map(c => [c.url, c])).values())
                                  .map((c, i) => ({ ...c, index: i + 1 }));

      return { title, author, description, cover, chapters: uniqueChapters };
    } catch (err) {
      console.error("Error en Metadatos:", err.message);
      throw new Error("No se pudo conectar con Wattpad. Revisa la URL.");
    }
  }

  // --- EXTRACCIÓN DE CONTENIDO DE CAPÍTULO ---
  async getChapterContent(chapterObj) {
    const cacheKey = `ch_${chapterObj.id}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const { data: html } = await this.client.get(chapterObj.url);
      const $ = cheerio.load(html);
      
      let bodyHtml = "";
      // Wattpad usa párrafos con IDs de datos o dentro de artículos
      const selectors = ["p[data-p-id]", "article p", ".story-panel p", "pre"];
      
      for (const selector of selectors) {
        if ($(selector).length > 0) {
          $(selector).each((_, el) => {
            bodyHtml += `<p>${$(el).html()}</p>`;
          });
          break;
        }
      }

      const result = {
        title: chapterObj.title,
        html: bodyHtml,
        text: htmlToText(bodyHtml, { wordwrap: false })
      };

      this._setCache(cacheKey, result);
      return result;
    } catch (err) {
      return { title: chapterObj.title, text: "[Error cargando contenido]", html: "" };
    }
  }
}

module.exports = new WattpadScraper();
      
