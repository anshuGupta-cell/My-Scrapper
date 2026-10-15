const form = document.getElementById("searchForm");
const input = document.getElementById("searchInput");
const button = document.getElementById("searchButton");
const status = document.getElementById("status");
const results = document.getElementById("results");
const resultCount = document.getElementById("resultCount");

let query = "";
let page = 1;
let loading = false;
let hasMore = false;
let controller = null;

const seenUrls = new Set();

function element(tag, className, text) {
  const el = document.createElement(tag);

  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;

  return el;
}

function safeUrl(value) {
  try {
    const url = new URL(value);

    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function createCard(item) {
  const card = element("article", "card");
  const thumbnail = element("div", "thumbnail");
  const imageUrl = safeUrl(item.thumbnail);
  const videoUrl = safeUrl(item.videoUrl);
  const previewUrl = safeUrl(item.preview);

  if (imageUrl) {
    const img = element("img");
    img.src = imageUrl;
    img.alt = item.title || "Video thumbnail";
    img.loading = "lazy";
    img.decoding = "async";
    thumbnail.append(img);
  }

  const content = element("div", "card-content");

  content.append(
    element("h3", "", item.title || "Untitled video")
  );

  const meta = element("div", "meta");

  if (item.duration) {
    meta.append(element("span", "", item.duration));
  }

  if (item.views) {
    meta.append(element("span", "", item.views));
  }

  content.append(meta);

  const actions = element("div", "actions");

  if (videoUrl) {
    const open = element("a", "open-button", "Open video");

    open.href = videoUrl;
    open.target = "_blank";
    open.rel = "noopener noreferrer";

    actions.append(open);
  }

  if (previewUrl) {
    const preview = element(
      "button",
      "preview-button",
      "Show preview"
    );

    preview.type = "button";

    preview.addEventListener("click", () => {
      const existing = thumbnail.querySelector("video");

      if (existing) {
        existing.remove();

        const img = thumbnail.querySelector("img");
        if (img) img.hidden = false;

        preview.textContent = "Show preview";
        return;
      }

      const video = element("video");

      video.src = previewUrl;
      video.controls = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "none";

      const img = thumbnail.querySelector("img");
      if (img) img.hidden = true;

      thumbnail.append(video);
      preview.textContent = "Hide preview";
    });

    actions.append(preview);
  }

  content.append(actions);
  card.append(thumbnail, content);

  return card;
}

async function loadMore(reset = false) {
  if (loading || (!hasMore && !reset)) return;

  if (reset) {
    if (controller) controller.abort();

    controller = new AbortController();
    page = 1;
    hasMore = true;
    seenUrls.clear();
    results.replaceChildren();
    resultCount.textContent = "";
  }

  loading = true;
  button.disabled = true;
  status.textContent = "Loading videos...";

  try {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(query)}&page=${page}`,
      { signal: controller.signal }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load videos.");
    }

    let added = 0;

    for (const item of data.results || []) {
      const url = safeUrl(item.videoUrl);

      if (!url || seenUrls.has(url)) continue;

      seenUrls.add(url);
      results.append(createCard(item));
      added++;
    }

    page++;
    hasMore = Boolean(data.hasMore);

    resultCount.textContent = `${seenUrls.size} videos`;

    if (!seenUrls.size) {
      results.append(
        element(
          "p",
          "empty",
          "No videos found. Try another search."
        )
      );
    }

    status.textContent = hasMore
      ? "Scroll down to load more."
      : "No more results available.";

    // Stop automatic repeated requests if a page contains
    // no new results.
    if (added === 0 && data.count > 0) {
      hasMore = false;
      status.textContent =
        "No new videos found on the next page.";
    }

  } catch (error) {
    if (error.name !== "AbortError") {
      status.textContent = error.message;
    }
  } finally {
    loading = false;
    button.disabled = false;
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  query = input.value.trim();

  if (!query) return;

  await loadMore(true);
});

window.addEventListener("scroll", () => {
  const nearBottom =
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 600;

  if (nearBottom) {
    loadMore();
  }
});
