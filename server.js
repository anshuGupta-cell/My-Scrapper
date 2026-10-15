const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  const parsedPage = Number.parseInt(req.query.page, 10);
  const page = Number.isFinite(parsedPage)
    ? Math.max(1, Math.min(100, parsedPage))
    : 1;

  if (!query || query.length > 150) {
    return res.status(400).json({
      error: "Enter a valid search term."
    });
  }

  try {
    const searchUrl = new URL(
      "/search/" +
        encodeURIComponent(query).replace(/%20/g, "+"),
      "https://xhamster46.desi"
    );

    if (page > 1) {
      searchUrl.searchParams.set("page", String(page));
    }

    const response = await axios.get(searchUrl.href, {
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: 3 * 1024 * 1024,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];
    const seen = new Set();

    $("a[href]").each((_, element) => {
      const link = $(element);
      const href = link.attr("href");

      if (!href) return;

      let videoUrl;

      try {
        videoUrl = new URL(href, searchUrl);
      } catch {
        return;
      }

      if (
        videoUrl.hostname !== "xhamster46.desi" ||
        !videoUrl.pathname.includes("/videos/") ||
        seen.has(videoUrl.href)
      ) {
        return;
      }

      const card = link.closest(
        "article, .thumb-list__item, .video-thumb, .thumb"
      );

      const container = card.length ? card : link;
      const img = container.find("img").first();

      const title =
        link.attr("title") ||
        img.attr("alt") ||
        container.find("h3, h4").first().text().trim() ||
        link.text().trim();

      if (!title) return;

      function absoluteUrl(value) {
        if (!value) return null;

        try {
          const url = new URL(value, searchUrl);

          if (!["http:", "https:"].includes(url.protocol)) {
            return null;
          }

          return url.href;
        } catch {
          return null;
        }
      }

      const thumbnail = absoluteUrl(
        img.attr("data-src") ||
        img.attr("data-original") ||
        img.attr("src")
      );

      const preview = absoluteUrl(
        img.attr("data-preview") ||
        img.attr("data-video") ||
        container.find("video source").attr("src") ||
        container.find("video").attr("src")
      );

      const duration =
        container.find("[class*=duration]")
          .first().text().trim() || null;

      const views =
        container.find("[class*=views]")
          .first().text().trim() || null;

      seen.add(videoUrl.href);

      results.push({
        title,
        videoUrl: videoUrl.href,
        thumbnail,
        preview,
        duration,
        views
      });
    });

    res.set("Cache-Control", "public, max-age=60");

    res.json({
      query,
      page,
      count: results.length,
      hasMore: results.length > 0 && page < 100,
      results
    });
  } catch (error) {
    console.error("Scraping error:", error.message);

    res.status(502).json({
      error: "Unable to retrieve search results."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
