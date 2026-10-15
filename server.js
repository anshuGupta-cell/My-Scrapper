const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query) {
    return res.status(400).json({
      error: "Enter a search term."
    });
  }

  if (query.length > 150) {
    return res.status(400).json({
      error: "Search term is too long."
    });
  }

  try {
    const searchUrl =
      "https://xhamster46.desi/search/" +
      encodeURIComponent(query).replace(/%20/g, "+");

    const response = await axios.get(searchUrl, {
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: 3 * 1024 * 1024,
      responseType: "text",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MetadataSearch/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    const $ = cheerio.load(response.data);
    const results = [];
    const seen = new Set();

    /*
      These are generic candidate selectors.
      They must be adjusted to match the site's actual HTML.
    */

    $("a[href]").each((_, element) => {
      const link = $(element);
      const href = link.attr("href");

      if (!href) return;

      let videoUrl;

      try {
        videoUrl = new URL(
          href,
          "https://xhamster46.desi"
        );
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

      const image = container.find("img").first();

      const title =
        link.attr("title") ||
        image.attr("alt") ||
        container.find("h3, h4").first().text().trim() ||
        link.text().trim();

      if (!title) return;

      const thumbnail =
        image.attr("data-src") ||
        image.attr("data-original") ||
        image.attr("src") ||
        null;

      const preview =
        image.attr("data-preview") ||
        image.attr("data-video") ||
        container.find("video source").attr("src") ||
        container.find("video").attr("src") ||
        null;

      const duration =
        container.find(
          ".duration, .video-duration, [class*=duration]"
        ).first().text().trim() || null;

      const views =
        container.find(
          ".views, .video-views, [class*=views]"
        ).first().text().trim() || null;

      const toAbsoluteUrl = value => {
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
      };

      seen.add(videoUrl.href);

      results.push({
        title,
        videoUrl: videoUrl.href,
        thumbnail: toAbsoluteUrl(thumbnail),
        preview: toAbsoluteUrl(preview),
        duration,
        views
      });
    });

    res.set("Cache-Control", "public, max-age=60");

    res.json({
      query,
      count: results.length,
      results
    });

  } catch (error) {
    console.error("Scraping error:", error.message);

    res.status(502).json({
      error:
        "Unable to retrieve search results. The website may be unavailable, blocking automated requests, or using a different HTML structure."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});