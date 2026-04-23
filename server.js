const express = require("express");
const compression = require("compression");
const scraper = require("./src/scraper");

const app = express();

// Middlewares Pro
app.use(compression()); // Gzip para ahorrar ancho de banda
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Configuración de Límites (Render Free Tier Safe)
const MAX_CONCURRENT_JOBS = 2;
let currentJobs = 0;

// --- ENDPOINT: OBTENER INFO ---
app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL requerida" });

  try {
    const data = await scraper.getStoryMetadata(url);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- ENDPOINT: CONVERSIÓN ---
app.post("/api/convert", async (req, res) => {
  if (currentJobs >= MAX_CONCURRENT_JOBS) {
    return res.status(503).json({ error: "Servidor saturado. Intenta en 1 minuto." });
  }

  const { url, format, chapters: indices } = req.body;
  if (!url || !format) return res.status(400).json({ error: "Faltan datos" });

  currentJobs++;
  console.log(`[JOB START] Unidades activas: ${currentJobs}`);

  try {
    // 1. Obtener Metadatos
    const metadata = await scraper.getStoryMetadata(url);
    
    // 2. Filtrar capítulos seleccionados
    const targetChapters = indices 
      ? metadata.chapters.filter(c => indices.includes(c.index))
      : metadata.chapters;

    // 3. Descarga Secuencial (Protege la RAM)
    const storyContent = [];
    for (const ch of targetChapters) {
      console.log(`[SCRAPE] Descargando: ${ch.title}`);
      const content = await scraper.getChapterContent(ch);
      storyContent.push(content);
      // Pequeño respiro para el event loop
      await new Promise(r => setTimeout(r, 500));
    }

    const fullStory = { ...metadata, chapters: storyContent };

    // 4. Lógica de Conversión (Ejemplo simplificado a TXT para el ejemplo)
    // Aquí llamarías a tus archivos en src/converters/
    let buffer;
    let mime;
    
    if (format === "txt") {
      const txt = fullStory.chapters.map(c => `${c.title.toUpperCase()}\n\n${c.text}`).join("\n\n---\n\n");
      buffer = Buffer.from(txt, "utf-8");
      mime = "text/plain";
    } else {
      // Aquí invocas toPdf(fullStory), etc.
      // const buffer = await toPdf(fullStory);
      throw new Error("Convertidor no implementado en este bloque de ejemplo");
    }

    // 5. Envío de Archivo
    const safeName = metadata.title.replace(/[^a-z0-9]/gi, "_");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${format}"`);
    res.send(buffer);

  } catch (err) {
    console.error("[JOB ERROR]", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    currentJobs--;
    console.log(`[JOB END] Unidades activas: ${currentJobs}`);
    
    // Sugerencia de limpieza de memoria
    if (global.gc) global.gc();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ###########################################
  🚀 SISTEMA DE DESCARGA PRO OPERATIVO
  📍 Puerto: ${PORT}
  📍 Modo: Render/Android Optimized
  ###########################################
  `);
});
  
