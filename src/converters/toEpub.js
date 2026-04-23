const JSZip = require("jszip");

async function toEpub(story) {
  const zip     = new JSZip();
  const bookId  = `wattpad-${story.id || Date.now()}`;
  const now     = new Date().toISOString().slice(0, 10);
  const epubDir = zip.folder("EPUB");

  // ── mimetype ────────────────────────────────────────────────
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // ── META-INF ────────────────────────────────────────────────
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  // ── CSS ─────────────────────────────────────────────────────
  epubDir.file("styles/main.css", `
@charset "UTF-8";
body  { font-family: Georgia, serif; line-height: 1.75; margin: 5% 7%; color: #222; }
h1    { font-size: 1.6em; text-align: center; color: #1a1a2e; margin-bottom: 0.2em; }
h2    { font-size: 1.2em; color: #16213e; border-bottom: 1px solid #e94560; padding-bottom: 0.3em; margin-top: 2em; }
p     { margin: 0.5em 0; text-align: justify; text-indent: 1.2em; }
p.first { text-indent: 0; }
.author { text-align:center; font-style:italic; color:#e94560; font-size:1.1em; }
.meta   { text-align:center; color:#888; font-size:0.85em; margin-top:2em; }
.desc   { font-style:italic; color:#555; border-left:3px solid #e94560; padding-left:1em; margin:1.5em 0; }
.chapter-img { display:block; max-width:100%; margin:1em auto; }
`);

  // ── Portada ──────────────────────────────────────────────────
  epubDir.file("cover.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es">
<head><meta charset="UTF-8"/><title>${ex(story.title)}</title>
<link rel="stylesheet" href="styles/main.css"/></head>
<body epub:type="frontmatter">
  <section epub:type="titlepage">
    <h1>${ex(story.title)}</h1>
    <p class="author">por ${ex(story.author)}</p>
    ${story.description ? `<p class="desc">${ex(story.description.slice(0, 500))}</p>` : ""}
    <p class="meta">${story.chapters.length} capítulos · Wattpad</p>
  </section>
</body></html>`);

  // ── Capítulos ────────────────────────────────────────────────
  const chapterFiles    = [];
  const allImageManifest = [];
  const imgFolder       = epubDir.folder("images");

  for (const ch of story.chapters) {
    const fname = `chapter_${String(ch.index).padStart(3, "0")}.xhtml`;

    // Registrar imágenes de este capítulo en el ZIP
    const chImgRefs = [];
    if (ch.images && ch.images.length > 0) {
      for (const img of ch.images) {
        const imgFile = `${img.id}.${img.ext}`;
        imgFolder.file(imgFile, img.buffer);
        allImageManifest.push({ id: img.id, href: `images/${imgFile}`, mime: img.mimeType });
        chImgRefs.push({ file: `images/${imgFile}`, id: img.id });
      }
    }

    const body = buildChapterBody(ch, chImgRefs);

    epubDir.file(fname, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es">
<head><meta charset="UTF-8"/><title>${ex(ch.title)}</title>
<link rel="stylesheet" href="styles/main.css"/></head>
<body epub:type="bodymatter chapter">
  <h2>Capítulo ${ch.index}: ${ex(ch.title)}</h2>
  ${body}
</body></html>`);

    chapterFiles.push({ id: `ch${ch.index}`, href: fname, title: ch.title });
  }

  // ── content.opf ─────────────────────────────────────────────
  const manifest = [
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="css"   href="styles/main.css" media-type="text/css"/>`,
    `<item id="ncx"   href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="nav"   href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...chapterFiles.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`),
    ...allImageManifest.map((img) => `<item id="${img.id}" href="${img.href}" media-type="${img.mime}"/>`),
  ].join("\n    ");

  const spine = [`<itemref idref="cover"/>`, ...chapterFiles.map((c) => `<itemref idref="${c.id}"/>`)].join("\n    ");

  epubDir.file("content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="es">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${bookId}</dc:identifier>
    <dc:title>${ex(story.title)}</dc:title>
    <dc:creator>${ex(story.author)}</dc:creator>
    <dc:language>es</dc:language>
    <dc:date>${now}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine toc="ncx">${spine}</spine>
</package>`);

  // ── nav.xhtml ────────────────────────────────────────────────
  epubDir.file("nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es">
<head><meta charset="UTF-8"/><title>Contenidos</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Contenidos</h1>
    <ol>
      <li><a href="cover.xhtml">Portada</a></li>
      ${chapterFiles.map((c, i) => `<li><a href="${c.href}">Cap. ${i + 1}: ${ex(c.title)}</a></li>`).join("\n      ")}
    </ol>
  </nav>
</body></html>`);

  // ── toc.ncx ──────────────────────────────────────────────────
  epubDir.file("toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${bookId}"/></head>
  <docTitle><text>${ex(story.title)}</text></docTitle>
  <navMap>
    <navPoint id="np0" playOrder="1"><navLabel><text>Portada</text></navLabel><content src="cover.xhtml"/></navPoint>
    ${chapterFiles.map((c, i) => `<navPoint id="np${i + 1}" playOrder="${i + 2}"><navLabel><text>${ex(c.title)}</text></navLabel><content src="${c.href}"/></navPoint>`).join("\n    ")}
  </navMap>
</ncx>`);

  return zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// ─── Utils ────────────────────────────────────────────────────
function ex(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Construye el body XHTML del capítulo intercalando imágenes en el texto.
 */
function buildChapterBody(ch, imgRefs) {
  const paras    = (ch.text || "").split(/\n{2,}/).filter((p) => p.trim());
  const imgCount = imgRefs.length;
  const imgEvery = imgCount > 0 ? Math.max(1, Math.floor(paras.length / imgCount)) : Infinity;
  let imgIdx     = 0;
  const parts    = [];

  for (let i = 0; i < paras.length; i++) {
    parts.push(`<p${i === 0 ? ' class="first"' : ""}>${ex(paras[i].trim().replace(/\n/g, " "))}</p>`);
    if (imgIdx < imgCount && (i + 1) % imgEvery === 0) {
      parts.push(`<img class="chapter-img" src="${imgRefs[imgIdx].file}" alt="imagen"/>`);
      imgIdx++;
    }
  }

  while (imgIdx < imgCount) {
    parts.push(`<img class="chapter-img" src="${imgRefs[imgIdx++].file}" alt="imagen"/>`);
  }

  return parts.join("\n  ") || '<p class="first">[Sin contenido]</p>';
}

module.exports = toEpub;
      
