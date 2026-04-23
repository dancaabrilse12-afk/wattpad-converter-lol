/**
 * server.js — WattFetch
 */
"use strict";

const express = require("express");
const cors    = require("cors");
const path    = require("path");

const scraper = require("./src/scraper");
const toTxt   = require("./src/converters/toTxt");
const toDocx  = require("./src/converters/toDocx");
const toEpub  = require("./src/converters/toEpub");
const toPdf   = require("./src/converters/toPdf");

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Health check (Render lo necesita) ───────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

// ── GET /api/info?url= ──────────────────────────────────────────
app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Falta el parámetro ?url=" });
  if (!url.includes("wattpad.com/story/"))
    return res.status(400).json({ error: "URL no válida. Debe ser una historia de Wattpad." });
  try {
    const data = await scraper.getStoryMetadata(url);
    res.json(data);
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "PRIVATE" ? 403 : 502;
    res.status(status).json({ error: err.message, code: err.code || "ERROR" });
  }
});

// ── POST /api/convert ───────────────────────────────────────────
// Body: { url, format, chapters? }
app.post("/api/convert", async (req, res) => {
  const { url, format = "txt", chapters: selectedIds } = req.body;
  if (!url) return res.status(400).json({ error: "Falta el campo 'url'." });

  const VALID = ["txt", "pdf", "epub", "docx"];
  if (!VALID.includes(format))
    return res.status(400).json({ error: `Formato inválido. Usa: ${VALID.join(", ")}` });

  let timedOut = false;
  const timer  = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent)
      res.status(504).json({ error: "Timeout: demasiados capítulos. Selecciona menos e inténtalo de nuevo." });
  }, 25000);

  try {
    const story = await scraper.getFullStory(url, selectedIds || null);
    if (timedOut) return;

    let buffer, mime, ext;
    switch (format) {
      case "txt":  buffer = await toTxt(story);  mime = "text/plain; charset=utf-8";                                                                  ext = "txt";  break;
      case "pdf":  buffer = await toPdf(story);  mime = "application/pdf";                                                                            ext = "pdf";  break;
      case "epub": buffer = await toEpub(story); mime = "application/epub+zip";                                                                       ext = "epub"; break;
      case "docx": buffer = await toDocx(story); mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";                    ext = "docx"; break;
    }

    if (timedOut) return;
    clearTimeout(timer);

    const filename = sanitize(story.title) + "." + ext;
    res.setHeader("Content-Type",        mime);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length",      buffer.length);
    res.setHeader("X-Story-Title",       encodeURIComponent(story.title));
    res.setHeader("X-Story-Chapters",    story.chapters.length);
    res.send(buffer);

  } catch (err) {
    clearTimeout(timer);
    if (timedOut || res.headersSent) return;
    console.error("[server] /api/convert:", err.message);
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "PRIVATE" ? 403 : 500;
    const msgs   = { NOT_FOUND: "Historia no encontrada.", PRIVATE: "Historia privada.", INVALID_URL: "URL inválida." };
    res.status(status).json({ error: msgs[err.code] || `Error: ${err.message}`, code: err.code });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

function sanitize(s) {
  return String(s || "Historia").replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "_").trim().substring(0, 80) || "Historia";
}

app.listen(PORT, "0.0.0.0", () => console.log(`✅ WattFetch en http://0.0.0.0:${PORT}`));
         
