const axios = require("axios");
const { convert: htmlToText } = require("html-to-text");

class WattpadError extends Error {
  constructor(message, code, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Huellas digitales de navegadores reales (Desktop y Mobile)
const AGENTS = [
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", platform: "Windows" },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36", platform: "macOS" },
  { ua: "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36", platform: "Android" }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Cliente HTTP con lógica de reintentos y cabeceras dinámicas
 */
async function apiCall(config, retries = 2) {
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  
  const headers = {
    "User-Agent": agent.ua,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Sec-Ch-Ua-Platform": `"${agent.platform}"`,
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Referer": "https://www.wattpad.com/",
    ...config.headers
  };

  for (let i = 0; i <= retries; i++) {
    try {
      return await axios({ ...config, headers, timeout: 15000 });
    } catch (err) {
      const isLast = i === retries;
      if (isLast || err.response?.status === 404) throw err;
      // Espera exponencial antes de reintentar
      await sleep(1000 * (i + 1));
    }
  }
}

const getStoryInfo = async (url) => {
  const id = url.match(/\/story\/(\d+)/)?.[1];
  if (!id) throw new WattpadError("URL no válida", "INVALID_URL", 400);

  try {
    const { data } = await apiCall({
      url: `https://www.wattpad.com/api/v3/stories/${id}`,
      params: { fields: "id,title,cover,user(name),description,numParts" }
    });
    return data;
  } catch (e) {
    throw new WattpadError("Wattpad bloqueó la información base", "INFO_BLOCKED", 502);
  }
};

const getChapterContent = async (id) => {
  const { data } = await apiCall({
    url: "https://www.wattpad.com/apiv2/storytext",
    params: { id }
  });
  const html = data.text || data.html || "";
  return {
    html,
    text: htmlToText(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] })
  };
};

const getFullStory = async (url, { chapterIndices = null } = {}) => {
  const info = await getStoryInfo(url);
  
  const { data: partsData } = await apiCall({
    url: `https://www.wattpad.com/api/v3/stories/${info.id}/parts`,
    params: { fields: "id,title" }
  });

  const allParts = (partsData.parts || partsData.pages).map((p, i) => ({ ...p, index: i + 1 }));
  const toFetch = chapterIndices 
    ? allParts.filter(p => chapterIndices.includes(p.index)) 
    : allParts;

  const chapters = [];
  
  // PROCESAMIENTO EN SERIE: Para no saturar la RAM de Render
  for (const part of toFetch) {
    try {
      console.log(`[Scraper] Descargando: ${part.title}`);
      const content = await getChapterContent(part.id);
      chapters.push({
        title: part.title,
        ...content
      });
      // Anti-ban: pausa aleatoria pequeña
      await sleep(300 + Math.random() * 500);
    } catch (e) {
      chapters.push({ title: part.title, text: "Contenido no disponible (Bloqueo de Wattpad)", html: "" });
    }
  }

  return {
    title: info.title,
    author: info.user.name,
    description: info.description,
    cover: info.cover,
    chapters
  };
};

module.exports = { getFullStory, getStoryInfo, getChapterList: async (url) => (await getStoryInfo(url)).numParts, WattpadError };
