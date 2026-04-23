```javascript
const express = require("express");
const compression = require("compression");
const scraper = require("./src/scraper");
const path = require("path");

const app = express();

// Configuración de Middlewares
app.use(compression());
app.use(express.json({ limit: "20mb" }));

// --- INTERFAZ WEB INTEGRADA (Para evitar el error de Server no disponible) ---
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Wattpad Converter Pro</title>
        <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f4f4f9; color: #333; }
            .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
            h1 { color: #ff6600; margin-bottom: 0.5rem; }
            p { margin-bottom: 1.5rem; line-height: 1.4; }
            .status { display: inline-block; padding: 0.5rem 1rem; background: #e2f9e1; color: #1e4620; border-radius: 20px; font-weight: bold; font-size: 0.9rem; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>Wattpad Pro</h1>
            <p>El servidor está <b>activo</b> y listo para procesar tus historias de Wattpad.</p>
            <div class="status">● Sistema en Línea</div>
        </div>
    </body>
    </html>
  `);
});

// --- RUTA DE INFORMACIÓN ---
app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Falta la URL de la historia" });

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
  if (!url || !format) return res.status(400).json({ error: "URL y formato requeridos" });

  try {
    const story = await scraper.getFullStory(url, { chapterIndices: chapters });
    
    let buffer;
    if (format === "txt") {
      const content = story.chapters.map(c => `${c.title.toUpperCase()}\n\n${c.text}`).join("\n\n---\n\n");
      buffer = Buffer.from(content, "utf-8");
    } else {
      return res.status(400).json({ error: "Formato no soportado aún en esta ruta" });
    }

    const safeTitle = story.title.replace(/[^a-z0-9]/gi, "_");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${format}"`);
    res.send(buffer);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MANEJO DE PUERTOS (CRÍTICO PARA RENDER) ---
// Render inyecta el puerto automáticamente. Usamos 10000 como fallback.
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("###########################################");
  console.log("🚀 SISTEMA DE DESCARGA PRO OPERATIVO");
  console.log(`📍 Puerto: ${PORT}`);
  console.log("📍 Modo: Render/Android Optimized");
  console.log("###########################################");
});

```
