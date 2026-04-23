const axios = require("axios");
const cheerio = require("cheerio");
const { convert: htmlToText } = require("html-to-text");
const fs = require("fs");
const path = require("path");

class WattpadScraper {
  constructor() {
    this.cacheDir = path.join(__dirname, "../.cache");
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
    
    // Fingimos ser un navegador Chrome normal
    this.client = axios.create({
      timeout: 25000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
        "Referer": "https://www.google.com/"
      }
    });
  }

  async getStoryMetadata(url) {
    try {
      const { data: html } = await this.client.get(url);
      const $ = cheerio.load(html);

      const title = $("h1").first().text().trim() || "Sin título";
      const author = $('.author-info__username, a.on-author').first().text().trim() || "Desconocido";
      
      const chapters = [];
      $('a[href*="/story/"]').each((i, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        if (href && text && href.includes("-")) {
          const fullUrl = href.startsWith("http") ? href : `https://www.wattpad.com${href}`;
          chapters.push({ title: text, url: fullUrl });
        }
      });

      // Limpiar duplicados
      const uniqueChapters = chapters.filter((c, index, self) =>
        index === self.findIndex((t) => t.url === c.url)
      ).map((c, i) => ({ ...c, index: i + 1 }));

      if (uniqueChapters.length === 0) throw new Error("No se encontraron capítulos.");
      return { title, author, chapters: uniqueChapters };
    } catch (err) {
      throw new Error("Wattpad bloqueó el acceso o la URL es inválida.");
    }
  }

  async getChapterContent(chapter) {
    try {
      const { data: html } = await this.client.get(chapter.url);
      const $ = cheerio.load(html);
      let bodyHtml = "";

      if ($("p[data-p-id]").length > 0) {
        $("p[data-p-id]").each((_, el) => { bodyHtml += `<p>${$(el).html()}</p>`; });
      } else {
        $('article, section, div').each((_, el) => {
          if ($(el).children('p').length > 5) {
            bodyHtml = $(el).html();
            return false; 
          }
        });
      }

      const text = htmlToText(bodyHtml, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] });
      return { title: chapter.title, text: text.trim() || "[Contenido vacío]", html: bodyHtml };
    } catch (err) {
      return { title: chapter.title, text: "[Error de carga]", html: "" };
    }
  }

  async getFullStory(url, opts = {}) {
    const metadata = await this.getStoryMetadata(url);
    const selected = opts.chapterIndices 
      ? metadata.chapters.filter(c => opts.chapterIndices.includes(c.index))
      : metadata.chapters;

    const chapters = [];
    for (const ch of selected) {
      chapters.push(await this.getChapterContent(ch));
      await new Promise(r => setTimeout(r, 600)); // Pausa humana
    }
    return { ...metadata, chapters };
  }
}

module.exports = new WattpadScraper();
