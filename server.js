const express = require("express");
const compression = require("compression");
const path = require("path");

// Cargamos el scraper con manejo de errores
let scraper;
try {
  scraper = require("./src/scraper");
} catch (err) {
  console.error("❌ Error cargando scraper:", err.message);
}

const app = express();

app.use(compression());
app.use(express.json({ limit: "20mb" }));

// --- RUTA RAIZ SIMPLIFICADA (Para evitar SyntaxError) ---
app.get("/", (req, res) => {
  res.status(200).send("Wattpad Converter API: Online. Scraper: " + (scraper ? "OK" : "Error"));
});

// --- RUTA DE INFORMACIÓN ---
app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!scraper) return res.status(500).json({ error: "Scraper no disponible" });
  if (!url) return res.status(400).json({ error: "URL requerida" });

  try {
    const data = await scraper.getStoryMetadata(url);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- RUTA DE CONVERSIÓN ---
app.post("/api/convert", async (req, res) => {
  const { url, format, chapters } = req.body;
  if (!scraper) return res.status(500).json({ error: "Scraper no disponible" });
  
  try {
    const story = await scraper.getFullStory(url, { chapterIndices: chapters });
    
    if (format === "txt") {
      const content = story.chapters.map(c => `${c.title.toUpperCase()}\n\n${c.text}`).join("\n\n---\n\n");
      const safeTitle = story.title.replace(/[^a-z0-9]/gi, "_");
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.txt"`);
      return res.send(content);
    }
    
    res.status(400).send("Formato no implementado");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PUERTO ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
