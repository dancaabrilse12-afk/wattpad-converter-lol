const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");

const scraper = require("./src/scraper");
const toTxt = require("./src/converters/toTxt");
const toPdf = require("./src/converters/toPdf");
const toEpub = require("./src/converters/toEpub");
const toDocx = require("./src/converters/toDocx");

// Seguridad global para que errores inesperados no maten el proceso
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// ─── Middlewares ──────────────────────────────────────────────
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "Demasiadas solicitudes. Espera 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/convert", limiter);

const SUPPORTED_FORMATS = ["pdf", "epub", "docx", "txt"];

function validateConvertRequest({ url, format }) {
  if (!url) return "El campo 'url' es requerido.";
  if (!url.includes("wattpad.com")) return "La URL debe ser de Wattpad.";
  if (!format) return "El campo 'format' es requerido.";
  if (!SUPPORTED_FORMATS.includes(String(format).toLowerCase())) {
    return `Formato no soportado. Usa: ${SUPPORTED_FORMATS.join(", ")}`;
  }
  return null;
}

// ─── Routes ───────────────────────────────────────────────────

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Frontend
app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// GET /api/info?url=…  → metadata sin capítulos
app.get("/api/info", async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).json({ error: "Falta 'url'." });
  if (!url.includes("wattpad.com")) {
    return res.status(400).json({ error: "URL debe ser de Wattpad." });
  }

  try {
    const info = await scraper.getStoryInfo(url);

    if (info?.error) {
      return res.status(502).json({
        error: "No se pudo obtener la información de Wattpad.",
        detail: info.detail || "Respuesta inválida o bloqueada.",
      });
    }

    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chapters?url=…  → lista ligera de capítulos (sin contenido)
app.get("/api/chapters", async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).json({ error: "Falta 'url'." });
  if (!url.includes("wattpad.com")) {
    return res.status(400).json({ error: "URL debe ser de Wattpad." });
  }

  try {
    const chapters = await scraper.getChapterList(url);

    if (chapters?.error) {
      return res.status(502).json({
        error: "No se pudo obtener la lista de capítulos.",
        detail: chapters.detail || "Respuesta inválida o bloqueada.",
      });
    }

    res.json({ chapters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/convert
// Body: { url, format, chapters?: number[], includeImages?: boolean }
app.post("/api/convert", async (req, res) => {
  const { url, format, chapters: selectedChapters, includeImages = false } = req.body;

  const err = validateConvertRequest(req.body);
  if (err) return res.status(400).json({ error: err });

  const fmt = String(format).toLowerCase();
  const rid = uuidv4().slice(0, 8);

  console.log(
    `[${rid}] ${url} → ${fmt.toUpperCase()} | caps: ${selectedChapters || "all"} | imgs: ${includeImages}`
  );

  try {
    const story = await scraper.getFullStory(url, {
      chapterIndices:
        Array.isArray(selectedChapters) && selectedChapters.length
          ? selectedChapters
          : null,
      includeImages,
    });

    let fileBuffer, mimeType, fileName;

    const safe = String(story.title || "historia")
      .replace(/[^a-z0-9áéíóúñ\s]/gi, "")
      .trim()
      .slice(0, 60) || "historia";

    switch (fmt) {
      case "txt":
        fileBuffer = await toTxt(story);
        mimeType = "text/plain; charset=utf-8";
        fileName = `${safe}.txt`;
        break;

      case "pdf":
        fileBuffer = await toPdf(story);
        mimeType = "application/pdf";
        fileName = `${safe}.pdf`;
        break;

      case "epub":
        fileBuffer = await toEpub(story);
        mimeType = "application/epub+zip";
        fileName = `${safe}.epub`;
        break;

      case "docx":
        fileBuffer = await toDocx(story);
        mimeType =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        fileName = `${safe}.docx`;
        break;

      default:
        return res.status(400).json({
          error: `Formato no soportado. Usa: ${SUPPORTED_FORMATS.join(", ")}`,
        });
    }

    console.log(
      `[${rid}] OK → ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)`
    );

    res.set({
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": fileBuffer.length,
      "X-Story-Title": encodeURIComponent(story.title || ""),
      "X-Story-Author": encodeURIComponent(story.author || ""),
      "X-Chapter-Count": String(story.chapters?.length || 0),
    });

    res.send(fileBuffer);
  } catch (err) {
    console.error(`[${rid}] Error:`, err);
    res.status(500).json({
      error: "Error al procesar la historia.",
      detail: err.message,
    });
  }
});

// 404
app.use((_req, res) => res.status(404).json({ error: "No encontrado." }));

app.listen(PORT, HOST, () => {
  console.log(`✓ API en puerto ${PORT}`);
});
