const express = require("express");
const cors = require("cors");
const compression = require("compression");
const { v4: uuidv4 } = require("uuid");
const scraper = require("./src/scraper");

// Conversores (Asumiendo que exportan funciones que reciben la historia y devuelven Buffer)
const converters = {
  pdf: require("./src/converters/toPdf"),
  epub: require("./src/converters/toEpub"),
  docx: require("./src/converters/toDocx"),
  txt: require("./src/converters/toTxt")
};

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Seguridad y Rendimiento
app.use(compression()); // Reduce el tamaño de las respuestas JSON/Texto
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static("public"));

/**
 * Manejador central de conversiones
 */
app.post("/api/convert", async (req, res) => {
  const { url, format, chapters: selectedChapters } = req.body;
  const requestId = uuidv4().slice(0, 8);

  if (!url || !format) {
    return res.status(400).json({ error: "Faltan parámetros: url y format son obligatorios." });
  }

  console.log(`[${requestId}] Iniciando conversión para: ${url} [${format}]`);

  try {
    // 1. Obtener datos de Wattpad
    const story = await scraper.getFullStory(url, { chapterIndices: selectedChapters });
    
    // 2. Seleccionar conversor
    const converter = converters[format.toLowerCase()];
    if (!converter) throw new Error("Formato no soportado");

    // 3. Generar archivo
    const buffer = await converter(story);

    // 4. Configurar cabeceras de descarga
    const fileName = `${story.title.replace(/[^a-z0-9]/gi, "_")}.${format}`;
    
    res.setHeader("Content-Type", getMimeType(format));
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader("Content-Length", buffer.length);

    // Enviar y limpiar
    res.send(buffer);
    
    console.log(`[${requestId}] Completado exitosamente.`);
    
    // Sugerir al recolector de basura (GC) que limpie el buffer
    // Importante en Render Free Tier
    setImmediate(() => { 
      story.chapters = null; 
    });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    const status = err instanceof scraper.WattpadError ? err.status : 500;
    res.status(status).json({ 
      error: "Error en el proceso", 
      detail: err.message,
      requestId 
    });
  }
});

function getMimeType(fmt) {
  const types = {
    pdf: "application/pdf",
    epub: "application/epub+zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain"
  };
  return types[fmt] || "application/octet-stream";
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor listo en puerto ${PORT}`);
});
