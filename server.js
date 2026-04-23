const express = require("express");
const compression = require("compression");

let scraper;
try {
  scraper = require("./src/scraper");
} catch (err) {
  console.error("❌ Error cargando scraper:", err.message);
}

const app = express();
app.use(compression());
app.use(express.json({ limit: "15mb" }));

// --- INTERFAZ WEB (FRONTEND) ---
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WattFetch • Descarga Historias</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0f172a; color: white; font-family: system-ui, -apple-system, sans-serif; }
        .glass { background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.1); }
    </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-center p-4">
    <div class="mb-8 text-center">
        <div class="glass px-4 py-2 rounded-full inline-flex items-center mb-6">
            <span class="text-sm font-medium">WattFetch 🟢</span>
            <div id="status-badge" class="ml-4 px-3 py-1 rounded-full text-xs font-bold bg-green-900/30 text-green-400">
                Servidor en línea
            </div>
        </div>
        <h1 class="text-4xl md:text-5xl font-bold mb-4">Descarga historias <br> en <span class="text-purple-400 italic">tu formato</span></h1>
        <p class="text-gray-400">Pega el enlace de Wattpad y descarga en formato TXT.</p>
    </div>

    <div class="glass w-full max-w-lg rounded-3xl p-6 shadow-2xl">
        <div class="mb-4 text-sm font-semibold text-gray-400 uppercase">1. Ingresa la URL de la historia</div>
        <input type="text" id="url" placeholder="https://www.wattpad.com/story/..." 
               class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-4 text-white focus:ring-2 focus:ring-purple-500 outline-none mb-4">
        
        <button onclick="loadStory()" id="main-btn" class="w-full bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 py-4 rounded-xl font-bold text-lg transition-all">
            Cargar capítulos
        </button>
        <div id="result" class="mt-4 text-sm text-center text-gray-300"></div>
    </div>

    <script>
        async function loadStory() {
            const url = document.getElementById('url').value;
            const btn = document.getElementById('main-btn');
            const resDiv = document.getElementById('result');
            
            if(!url.includes('wattpad.com')) return alert('Por favor ingresa una URL válida de Wattpad');

            btn.disabled = true;
            btn.innerText = 'Buscando historia...';
            resDiv.innerText = '';

            try {
                const response = await fetch('/api/info?url=' + encodeURIComponent(url));
                const data = await response.json();
                
                if(data.error) throw new Error(data.error);

                resDiv.innerHTML = '<span class="text-green-400 font-bold">✓ ' + data.title + '</span> (' + data.chapters.length + ' capítulos encontrados)';
                btn.innerText = 'Descargar TXT';
                btn.disabled = false;
                btn.onclick = () => downloadTxt(url);
            } catch (err) {
                resDiv.innerHTML = '<span class="text-red-400">Error: ' + err.message + '</span>';
                btn.disabled = false;
                btn.innerText = 'Cargar capítulos';
            }
        }

        async function downloadTxt(url) {
            const btn = document.getElementById('main-btn');
            btn.innerText = 'Procesando descarga...';
            btn.disabled = true;
            
            try {
                const res = await fetch('/api/convert', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ url, format: 'txt' })
                });
                
                if(!res.ok) throw new Error("Fallo en la conversión");

                const blob = await res.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = "Historia_Wattpad.txt";
                document.body.appendChild(a);
                a.click();
                a.remove();
                
                btn.innerText = '¡Descarga Completa!';
                setTimeout(() => { btn.innerText = 'Descargar TXT'; btn.disabled = false; }, 3000);
            } catch (e) {
                alert('Error al descargar. Intenta de nuevo.');
                btn.innerText = 'Descargar TXT';
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>
  `);
});

// --- API ENDPOINTS ---
app.get("/api/info", async (req, res) => {
  if (!scraper) return res.status(500).json({ error: "Scraper inactivo" });
  try {
    const data = await scraper.getStoryMetadata(req.query.url);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/convert", async (req, res) => {
  if (!scraper) return res.status(500).json({ error: "Scraper inactivo" });
  try {
    const story = await scraper.getFullStory(req.body.url);
    const textData = story.chapters.map(c => `${c.title}\n\n${c.text}`).join("\n\n------------------------\n\n");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(textData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});
