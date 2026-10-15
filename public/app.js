const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const resultsContainer = document.getElementById("results");
const statusElement = document.getElementById("status");
const resultCount = document.getElementById("resultCount");
const pageIndicator = document.getElementById("pageIndicator");
const loadMoreButton = document.getElementById("loadMoreButton");
const scrollSentinel = document.getElementById("scrollSentinel");
const dataSaver = document.getElementById("dataSaver");

const HOVER_DELAY = 600;
const MAX_PREVIEW_SECONDS = 4;

let currentQuery = "";
let currentPage = 0;
let loading = false;
let hasMore = false;
let hoverTimer = null;
let previewTimer = null;
let searchController = null;
let searchId = 0;

const seenVideoUrls = new Set();
let activePreview = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function safeUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value, location.origin);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

// Ask the image server for a smaller thumbnail where supported.
function optimizedThumbnail(value) {
  const url = safeUrl(value);

  if (!url) return "";

  try {
    const parsed = new URL(url);

    parsed.pathname = parsed.pathname.replace(
      /s\(w:\d+,h:\d+\),webp/i,
      "s(w:480,h:270),webp"
    );

    return parsed.href;
  } catch {
    return url;
  }
}

function createVideoCard(video) {
  const videoUrl = safeUrl(video.videoUrl);
  const thumbnail = optimizedThumbnail(
    video.thumbnail || video.previewThumbnail
  );
  const preview = safeUrl(video.preview);

  if (!videoUrl) return null;

  const card = document.createElement("article");
  card.className = "video-card";

  card.innerHTML = `
    <div class="thumbnail-container">
      ${
        thumbnail
          ? `<img
              src="${escapeHTML(thumbnail)}"
              alt=""
              loading="lazy"
              decoding="async"
              fetchpriority="low"
            >`
          : `<div class="thumbnail-placeholder"></div>`
      }

      ${
        preview
          ? `<video
              class="video-preview"
              data-src="${escapeHTML(preview)}"
              muted
              loop
              playsinline
              preload="none"
              hidden
            ></video>`
          : ""
      }

      ${
        video.duration
          ? `<span class="duration">${escapeHTML(video.duration)}</span>`
          : ""
      }
    </div>

    <div class="video-info">
      <a
        class="video-title"
        href="${escapeHTML(videoUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        title="${escapeHTML(video.title || "")}"
      >${escapeHTML(video.title || "Untitled video")}</a>

      <div class="video-meta">
        ${video.views ? `<span>${escapeHTML(video.views)}</span>` : ""}
      </div>
    </div>
  `;

  return card;
}

function stopPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;

  if (!activePreview) return;

  const video = activePreview;

  video.pause();
  video.hidden = true;

  // Remove the source to prevent continued downloads.
  video.removeAttribute("src");
  video.load();

  activePreview = null;
}

async function startPreview(container) {
  if (dataSaver.checked) return;
  if (!container.matches(":hover")) return;

  const video = container.querySelector(".video-preview");

  if (!video || !video.dataset.src) return;

  stopPreview();

  activePreview = video;
  video.src = video.dataset.src;
  video.hidden = false;
  video.preload = "none";

  try {
    await video.play();

    if (activePreview !== video) return;

    previewTimer = setTimeout(() => {
      stopPreview();
    }, MAX_PREVIEW_SECONDS * 1000);
  } catch {
    if (activePreview === video) {
      stopPreview();
    }
  }
}

// Hover starts a preview only after a short delay.
resultsContainer.addEventListener("pointerover", (event) => {
  if (event.pointerType !== "mouse" || dataSaver.checked) return;

  const container = event.target.closest(".thumbnail-container");

  if (!container || container.contains(event.relatedTarget)) return;

  clearTimeout(hoverTimer);

  hoverTimer = setTimeout(() => {
    startPreview(container);
  }, HOVER_DELAY);
});

resultsContainer.addEventListener("pointerout", (event) => {
  if (event.pointerType !== "mouse") return;

  const container = event.target.closest(".thumbnail-container");

  if (!container || container.contains(event.relatedTarget)) return;

  clearTimeout(hoverTimer);

  if (
    activePreview &&
    activePreview.closest(".thumbnail-container") === container
  ) {
    stopPreview();
  }
});

// Data Saver is enabled by default.
dataSaver.addEventListener("change", () => {
  if (dataSaver.checked) {
    clearTimeout(hoverTimer);
    stopPreview();
  }
});

async function loadPage(reset = false) {
  if (loading) return;
  if (!reset && !hasMore) return;

  if (reset) {
    if (searchController) searchController.abort();

    stopPreview();
    clearTimeout(hoverTimer);

    searchController = new AbortController();
    searchId++;

    resultsContainer.replaceChildren();
    seenVideoUrls.clear();

    currentPage = 0;
    hasMore = false;

    resultCount.textContent = "Loading...";
    pageIndicator.textContent = "";
  }

  const requestId = searchId;

  loading = true;
  searchButton.disabled = true;
  loadMoreButton.hidden = true;
  statusElement.textContent = "Loading videos...";

  const nextPage = currentPage + 1;

  try {
    const params = new URLSearchParams({
      q: currentQuery,
      page: String(nextPage)
    });

    const response = await fetch(`/api/search?${params}`, {
      signal: searchController?.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const data = await response.json();

    if (requestId !== searchId) return;

    if (!Array.isArray(data.results)) {
      throw new Error(data.error || "Invalid API response");
    }

    const fragment = document.createDocumentFragment();
    let added = 0;

    for (const video of data.results) {
      const url = safeUrl(video.videoUrl);

      if (!url || seenVideoUrls.has(url)) continue;

      seenVideoUrls.add(url);

      const card = createVideoCard(video);

      if (card) {
        fragment.appendChild(card);
        added++;
      }
    }

    resultsContainer.appendChild(fragment);

    currentPage = nextPage;
    hasMore = data.results.length > 0;

    resultCount.textContent = `${resultsContainer.children.length} videos loaded`;
    pageIndicator.textContent = `Page ${currentPage}`;

    statusElement.textContent = hasMore
      ? ""
      : resultsContainer.children.length
        ? "No more results."
        : "No videos found.";

    loadMoreButton.hidden = !hasMore;
  } catch (error) {
    if (error.name === "AbortError") return;

    console.error(error);

    if (requestId === searchId) {
      statusElement.textContent =
        "Could not load results. Please try again.";
      loadMoreButton.hidden = false;
    }
  } finally {
    if (requestId === searchId) {
      loading = false;
      searchButton.disabled = false;
    }
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = searchInput.value.trim();

  if (!query) return;

  currentQuery = query;
  await loadPage(true);
});

loadMoreButton.addEventListener("click", () => {
  loadPage();
});

// Load the next page before the user reaches the bottom.
const observer = new IntersectionObserver(
  (entries) => {
    if (
      entries.some((entry) => entry.isIntersecting) &&
      hasMore &&
      !loading
    ) {
      loadPage();
    }
  },
  { rootMargin: "350px 0px" }
);

observer.observe(scrollSentinel);
