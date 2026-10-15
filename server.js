app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const page = Math.max(
    1,
    Math.min(100, Number.parseInt(req.query.page, 10) || 1)
  );

  if (!query || query.length > 150) {
    return res.status(400).json({
      error: "Enter a valid search term."
    });
  }

  try {
    const searchUrl = new URL(
      "/search/" + encodeURIComponent(query).replace(/%20/g, "+"),
      "https://xhamster46.desi"
    );

    // Verify this parameter against the site's actual pagination.
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

      let url;

      try {
        url = new URL(href, searchUrl);
      } catch {
        return;
      }

      if (
        url.hostname !== "xhamster46.desi" ||
        !url.pathname.includes("/videos/") ||
        seen.has(url.href)
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

      const absolute = value => {
        if (!value) return null;

        try {
          const parsed = new URL(value, searchUrl);

          if (!["http:", "https:"].includes(parsed.protocol)) {
            return null;
          }

          return parsed.href;
        } catch {
          return null;
        }
      };

      const thumbnail = absolute(
        img.attr("data-src") ||
        img.attr("data-original") ||
        img.attr("src")
      );

      const preview = absolute(
        img.attr("data-preview") ||
        img.attr("data-video") ||
        container.find("video source").attr("src") ||
        container.find("video").attr("src")
      );

      const duration =
        container.find("[class*=duration]").first().text().trim() ||
        null;

      const views =
        container.find("[class*=views]").first().text().trim() ||
        null;

      seen.add(url.href);

      results.push({
        title,
        videoUrl: url.href,
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
      error: "Unable to retrieve this search page."
    });
  }
});
