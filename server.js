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
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache"
};

// Convert relative URLs into absolute URLs.
function absoluteUrl(url) {
  if (!url || typeof url !== "string") return null;

  url = url.trim();

  if (
    !url ||
    url.startsWith("data:") ||
    url.startsWith("javascript:")
  ) {
    return null;
  }

  try {
    return new URL(url, BASE_URL).href;
  } catch {
    return null;
  }
}

// Read the first available attribute from an element.
function getAttribute($element, attributes) {
  for (const attribute of attributes) {
    const value = $element.attr(attribute);

    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

// Extract a thumbnail from common image attributes.
function extractThumbnail($, card) {
  const image = card.find("img").first();

  const value = getAttribute(image, [
    "data-src",
    "data-original",
    "data-lazy-src",
    "src",
    "data-thumb"
  ]);

  if (value) {
    return absoluteUrl(value);
  }

  // Some websites put thumbnails on the card itself.
  const background = getAttribute(card, [
    "data-thumb",
    "data-thumbnail",
    "data-image"
  ]);

  if (background) {
    return absoluteUrl(background);
  }

  return null;
}

// Determine whether a URL looks like a playable preview.
function isVideoPreviewUrl(url) {
  if (!url) return false;

  const cleanUrl = url.split(/[?#]/)[0].toLowerCase();

  // Common video formats.
  if (/\.(mp4|webm|m4v|ogv|m3u8)$/i.test(cleanUrl)) {
    return true;
  }

  // Common preview-related URL patterns.
  return (
    /preview/i.test(url) &&
    /\.(mp4|webm|m4v|ogv)(?:[?#]|$)/i.test(url)
  );
}

// Extract preview URLs from a video's search-result card.
function extractPreview($, card) {
  const candidates = [];

  // 1. Look for actual video elements and their sources.
  card.find("video").each((_, element) => {
    const video = $(element);

    const src = getAttribute(video, [
      "src",
      "data-src",
      "data-video-src",
      "data-preview",
      "data-preview-url"
    ]);

    if (src) candidates.push(src);

    video.find("source").each((__, source) => {
      const sourceElement = $(source);

      const sourceUrl = getAttribute(sourceElement, [
        "src",
        "data-src"
      ]);

      if (sourceUrl) candidates.push(sourceUrl);
    });
  });

  // 2. Check common preview attributes on the card and descendants.
  const previewAttributes = [
    "data-preview",
    "data-preview-url",
    "data-preview-src",
    "data-video-preview",
    "data-video-preview-url",
    "data-video-src",
    "data-preview-video",
    "data-preview-video-url",
    "data-mp4",
    "data-video"
  ];

  const elements = [card[0], ...card.find("*").toArray()];

  for (const element of elements) {
    const el = $(element);

    for (const attribute of previewAttributes) {
      const value = el.attr(attribute);

      if (value) candidates.push(value);
    }
  }

  // 3. Check inline scripts inside the card.
  card.find("script").each((_, element) => {
    const scriptText = $(element).html() || "";

    const urlMatches = scriptText.match(
      /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp4|webm|m4v|ogv)(?:\?[^"'\\\s<>]*)?/gi
    );

    if (urlMatches) {
      candidates.push(...urlMatches);
    }
  });

  // Return the first URL that looks like a playable video.
  for (let candidate of candidates) {
    candidate = candidate
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .trim();

    const url = absoluteUrl(candidate);

    if (url && isVideoPreviewUrl(url)) {
      return url;
    }
  }

  return null;
}

// Extract text matching a selector.
function extractText(card, selectors) {
  for (const selector of selectors) {
    const element = card.find(selector).first();
    const value = element.text().trim();

    if (value) return value;
  }

  return null;
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

    const $ = cheerio.load(response.data);
    const results = [];
    const seenUrls = new Set();

    // Search for video-page links.
    $('a[href*="/videos/"]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr("href");

      if (!href) return;

      const videoUrl = absoluteUrl(href);

      if (!videoUrl) return;

      const parsedUrl = new URL(videoUrl);

      // Exclude creator listings and other nested paths.
      if (!/^\/videos\/[^/]+\/?$/i.test(parsedUrl.pathname)) {
        return;
      }

      if (seenUrls.has(videoUrl)) return;

      // Find the likely video-card container.
      let card = anchor.closest(
        "article, .thumb-list__item, .video-thumb, .thumb, .thumb-container"
      );

      // Fallback if the website uses different class names.
      if (!card.length) {
        card = anchor.parent();
      }

      // Find the title.
      const title =
        anchor.attr("title") ||
        anchor.attr("aria-label") ||
        extractText(card, [
          ".title",
          ".thumb-under-title",
          ".video-title",
          "[class*='title']"
        ]) ||
        anchor.text().trim();

      if (!title) return;

      const thumbnail = extractThumbnail($, card);
      const preview = extractPreview($, card);

      const duration = extractText(card, [
        ".duration",
        ".thumb-image-container__duration",
        "[class*='duration']"
      ]);

      const views = extractText(card, [
        ".views",
        "[class*='views']"
      ]);

      seenUrls.add(videoUrl);

      results.push({
        title: title.trim(),
        videoUrl,
        thumbnail,
        preview,
        duration,
        views
      });
    });

    console.log(
      `Found ${results.length} results; previews: ${
        results.filter((item) => item.preview).length
      }`
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
