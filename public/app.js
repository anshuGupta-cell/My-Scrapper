const form = document.getElementById("searchForm");
const input = document.getElementById("searchInput");
const button = document.getElementById("searchButton");
const status = document.getElementById("status");
const results = document.getElementById("results");
const resultCount = document.getElementById("resultCount");

let activeRequest = null;

function safeUrl(value) {
  try {
    const url = new URL(value);

    if (!["https:", "http:"].includes(url.protocol)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

function renderResults(items) {
  results.replaceChildren();

  if (!items.length) {
    results.append(
      makeElement(
        "p",
        "empty",
        "No results found. Try another search."
      )
    );

    return;
  }

  for (const item of items) {
    const card = makeElement("article", "card");
    const thumbnail = makeElement("div", "thumbnail");

    const thumbnailUrl = safeUrl(item.thumbnail);
    const previewUrl = safeUrl(item.preview);
    const videoUrl = safeUrl(item.videoUrl);

    if (thumbnailUrl) {
      const img = makeElement("img");

      img.src = thumbnailUrl;
      img.alt = item.title || "Video thumbnail";
      img.loading = "lazy";
      img.decoding = "async";

      thumbnail.append(img);
    }

    const content = makeElement("div", "card-content");

    content.append(
      makeElement("h3", "", item.title || "Untitled video")
    );

    const meta = makeElement("div", "meta");

    if (item.duration) {
      meta.append(makeElement("span", "", item.duration));
    }

    if (item.views) {
      meta.append(makeElement("span", "", item.views));
    }

    content.append(meta);

    const actions = makeElement("div", "actions");

    if (videoUrl) {
      const open = makeElement("a", "open-button", "Open video");

      open.href = videoUrl;
      open.target = "_blank";
      open.rel = "noopener noreferrer";

      actions.append(open);
    }

    if (previewUrl) {
      const preview = makeElement(
        "button",
        "preview-button",
        "Show preview"
      );

      preview.type = "button";

      preview.addEventListener("click", () => {
        const existingVideo = thumbnail.querySelector("video");

        if (existingVideo) {
          existingVideo.remove();

          const img = thumbnail.querySelector("img");

          if (img) img.hidden = false;

          preview.textContent = "Show preview";
          return;
        }

        const video = makeElement("video");

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
    results.append(card);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  const query = input.value.trim();

  if (!query) return;

  if (activeRequest) {
    activeRequest.abort();
  }

  activeRequest = new AbortController();

  button.disabled = true;
  status.textContent = "Searching...";
  resultCount.textContent = "";
  results.replaceChildren();

  try {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(query)}`,
      { signal: activeRequest.signal }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Search failed.");
    }

    renderResults(data.results || []);

    resultCount.textContent =
      `${data.count || 0} results`;

    status.textContent = "Search completed.";

  } catch (error) {
    if (error.name === "AbortError") return;

    status.textContent = error.message;

    results.replaceChildren(
      makeElement("p", "empty", error.message)
    );

  } finally {
    button.disabled = false;
    activeRequest = null;
  }
});
