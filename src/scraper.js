const axios = require("axios");
const cheerio = require("cheerio");
const { convert } = require("html-to-text");

class WattpadScraper {
    constructor() {
        this.client = axios.create({
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
    }

    async getStoryMetadata(url) {
        const { data } = await this.client.get(url);
        const $ = cheerio.load(data);
        const chapters = [];
        $('a[href*="/story/"]').each((i, el) => {
            const href = $(el).attr("href");
            if (href && href.match(/\/story\/\d+-/)) {
                chapters.push({ title: $(el).text().trim(), url: "https://www.wattpad.com" + href });
            }
        });
        return { 
            title: $("h1").first().text().trim(), 
            author: $(".author-info__username").first().text().trim() || "Autor",
            chapters: chapters.filter((v,i,a)=>a.findIndex(t=>(t.url===v.url))===i).map((c,i)=>({...c, index: i+1}))
        };
    }

    async getFullStory(url) {
        const meta = await this.getStoryMetadata(url);
        for (let ch of meta.chapters) {
            const { data } = await this.client.get(ch.url);
            const $ = cheerio.load(data);
            let html = "";
            $("p[data-p-id]").each((_, el) => { html += `<p>${$(el).html()}</p>`; });
            ch.text = convert(html, { wordwrap: false });
        }
        return meta;
    }
}

module.exports = new WattpadScraper();
