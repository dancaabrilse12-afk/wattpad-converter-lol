const axios = require("axios");
const cheerio = require("cheerio");
const { convert: htmlToText } = require("html-to-text");
const fs = require("fs");
const path = require("path");

class WattpadScraper {
  constructor() {
    this.cacheDir = path.join(__dirname, "../.cache");
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir);
    
    // Headers para parecer un navegador real y evitar el bloqueo
    this.client = axios.create({
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3",
        "Alt-Used": "www.wattpad.com",
        "Upgrade-Insecure-Requests": "1"
      }
    });
  }

  // --- OBTENER INFO Y LISTA DE CAPÍTULOS (Desde el HTML) ---
  async getStoryMetadata(url) {
    try {
      console.log(`[SCRAPER] Extrayendo info de: ${url}`);
      const { data: html } = await this.client.get(url);
      const $ = cheerio.load(html);

      // Usamos selectores CSS que Wattpad usa en su web pública
      const title = $("h1").first().text().trim() || "Historia sin título";
      const author = $('.author-info__username').first().text().trim() || "Autor desconocido";
      
      const chapters = [];
      // Buscamos todos los enlaces que lleven a partes de la historia
      // Wattpad suele usar el patrón /story/ID-titulo-del-capitulo
      $('a[href*="/story/"]').each((i, el) => {
        const href = $(el).attr("href");
        const name = $(el).find('.part-title').text().trim() || $(el).text().trim();
        
        if (href && name && href.includes("-")) {
          const fullUrl = href.startsWith("http") ? href : `https://www.wattpad.com${href}`;
          chapters.push({
            index: i + 1,
            title: name,
            url: fullUrl,
            // Extraemos un ID único de la URL para la caché
            id: href.match(/\/(\d+)-/)?.[1] || Math.random().toString(36).substring(7)
          });
        }
      });

      // Filtramos duplicados (a veces aparecen en el footer o menús)
      const uniqueChapters = Array.from(new Map(chapters.map(c => [c.url, c])).values())
                                  .map((c, i) => ({ ...c, index: i + 1 }));

      if (uniqueChapters.length === 0) {
        throw new Error("No se encontraron capítulos. ¿La historia es privada o para adultos?");
      }

      return { title, author, chapters: uniqueChapters };
    } catch (err) {
      console.error("Error en getStoryMetadata:", err.message);
      throw new Error("Wattpad bloqueó el acceso o la URL es inválida.");
    }
  }

  // --- OBTENER CONTENIDO (Sin usar API /apiv2) ---
  async getChapterContent(chapterObj) {
    try {
      console.log(`[SCRAPER] Leyendo capítulo: ${chapterObj.title}`);
      const { data: html } = await this.client.get(chapterObj.url);
      const $ = cheerio.load(html);
      
      let bodyHtml = "";

      // Wattpad inserta el texto en etiquetas <p> con el atributo data-p-id
      // Esta es la forma más estable de extraerlo sin usar la API
      const paragraphs = $("p[data-p-id]");
      
      if (paragraphs.length > 0) {
        paragraphs.each((_, el) => {
          bodyHtml += `<p>${$(el).html()}</p>`;
        });
      } else {
        // Fallback: Si no hay data-p-id, buscamos el contenedor de la historia
        bodyHtml = $(".story-panel, .panel-reading").html() || "";
      }

      const text = htmlToText(bodyHtml, {
        wordwrap: false,
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: 'a', options: { ignoreHref: true } }
        ]
      });

      return {
        title: chapterObj.title,
        html: bodyHtml,
        text: text.trim() || "[Contenido vacío o protegido]"
      };
    } catch (err) {
      console.error(`Error en capítulo ${chapterObj.title}:`, err.message);
      return { title: chapterObj.title, text: "[Error al cargar el contenido]", html: "" };
    }
  }

  // --- PROCESO COMPLETO ---
  async getFullStory(url, opts = {}) {
    const metadata = await this.getStoryMetadata(url);
    
    // Si el usuario eligió capítulos específicos, los filtramos
    const targetChapters = opts.chapterIndices 
      ? metadata.chapters.filter(c => opts.chapterIndices.includes(c.index))
      : metadata.chapters;

    const storyContent = [];
    for (const ch of targetChapters) {
      const content = await this.getChapterContent(ch);
      storyContent.push(content);
      
      // PAUSA DE SEGURIDAD: Evita que Wattpad detecte ráfagas de peticiones
      await new Promise(r => setTimeout(r, 800)); 
    }

    return { ...metadata, chapters: storyContent };
  }
}

module.exports = new WattpadScraper();
        
