const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://xhamster46.desi";

app.use(express.static(path.join(__dirname, "public")));

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

// Convert relative URLs to absolute URLs.
function absoluteUrl(value) {
  if (!value || typeof value !== "string") return null;

  try {
    const url = new URL(value, BASE_URL);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

// Extract a JSON array from embedded page data.
// Handles strings containing brackets without confusing them
// with the brackets that delimit the array.
function extractJsonArray(html, propertyName) {
  const patterns = [
    `"${propertyName}"`,
    `\\u0022${propertyName}\\u0022`
  ];

  let propertyIndex = -1;

  for (const pattern of patterns) {
    propertyIndex = html.indexOf(pattern);

    if (propertyIndex !== -1) break;
  }

  if (propertyIndex === -1) return null;

  const start = html.indexOf("[", propertyIndex);

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;

      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

// Format duration in seconds as MM:SS or HH:MM:SS.
function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) {
    return null;
  }

  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (number) => String(number).padStart(2, "0");

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
    : `${pad(minutes)}:${pad(secs)}`;
}

// Format view count.
function formatViews(views) {
  if (views == null || !Number.isFinite(Number(views))) {
    return null;
  }

  return `${Number(views).toLocaleString("en-US")} views`;
}

// Map the website's videoThumbProps to your API response.
function normalizeVideo(video) {
  const preview =
    absoluteUrl(video.trailerURL) ||
    absoluteUrl(video.trailerFallbackUrl);

  return {
    title: video.title || "",
    videoUrl: absoluteUrl(video.pageURL),
    thumbnail:
      absoluteUrl(video.thumbURL) ||
      absoluteUrl(video.imageURL),
    preview,
    previewThumbnail: absoluteUrl(video.previewThumbURL),
    duration: formatDuration(video.duration),
    views: formatViews(video.views)
  };
}

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  const parsedPage = Number.parseInt(req.query.page || "1", 10);
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
      "/search/" + encodeURIComponent(query).replace(/%20/g, "+"),
      BASE_URL
    );

    if (page > 1) {
      searchUrl.searchParams.set("page", String(page));
    }

    console.log("Fetching:", searchUrl.href);

    const response = await axios.get(searchUrl.href, {
      timeout: 30000,
      maxRedirects: 5,
      responseType: "text",
      headers: HEADERS
    });

    const html = response.data;

    // Preferred method: extract the site's embedded video data.
    const videoThumbProps = extractJsonArray(
      html,
      "videoThumbProps"
    );

    if (Array.isArray(videoThumbProps)) {
      const results = videoThumbProps
        .filter((video) => video && video.videoType === "video")
        .map(normalizeVideo)
        .filter((video) => video.videoUrl);

      console.log(
        `Results: ${results.length}; previews: ${
          results.filter((video) => video.preview).length
        }`
      );

      return res.json({
        query,
        page,
        count: results.length,
        results
      });
    }

    // Fallback: extract basic results from HTML cards.
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();

    $('a[href*="/videos/"]').each((_, element) => {
      const anchor = $(element);
      const videoUrl = absoluteUrl(anchor.attr("href"));

      if (!videoUrl || seen.has(videoUrl)) return;

      const pathname = new URL(videoUrl).pathname;

      if (!/^\/videos\/[^/]+\/?$/i.test(pathname)) return;

      const card = anchor.closest(
        "article, .thumb-list__item, .video-thumb, .thumb"
      );

      const title =
        anchor.attr("title") ||
        anchor.attr("aria-label") ||
        card.find("[class*='title']").first().text().trim() ||
        anchor.text().trim();

      if (!title) return;

      const image = card.find("img").first();

      const thumbnail = absoluteUrl(
        image.attr("data-src") ||
          image.attr("data-original") ||
          image.attr("src")
      );

      seen.add(videoUrl);

      results.push({
        title,
        videoUrl,
        thumbnail,
        preview: null,
        previewThumbnail: null,
        duration: null,
        views: null
      });
    });

    console.log(
      `Fallback results: ${results.length}. Embedded video data was not found.`
    );

    res.json({
      query,
      page,
      count: results.length,
      results
    });
  } catch (error) {
    console.error("Scraping error:", {
      message: error.message,
      status: error.response?.status,
      code: error.code
    });

    res.status(502).json({
      error: "Unable to retrieve search results."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
