const express = require("express");
const path = require("path");
const scraper = require("./src/scraper");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // <--- ESTO ES VITAL

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/info", async (req, res) => {
    try {
        const data = await scraper.getStoryMetadata(req.query.url);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/convert", async (req, res) => {
    try {
        const story = await scraper.getFullStory(req.body.url);
        const content = story.chapters.map(c => `${c.title}\n\n${c.text}`).join("\n\n---\n\n");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(content);
    } catch (err) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => console.log(`Servidor en puerto ${PORT}`));
