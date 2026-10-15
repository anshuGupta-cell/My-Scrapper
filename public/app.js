// DOM Element References
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
const layoutToggle = document.getElementById("layoutToggle");

// App Constants & State
const HOVER_DELAY = 600;
const MAX_PREVIEW_SECONDS = Infinity;

let currentQuery = "";
let currentPage = 0;
let loading = false;
let hasMore = false;
let hoverTimer = null;
let previewTimer = null;
let searchController = null;
let searchId = 0;
let activePreview = null;

const seenVideoUrls = new Set();

/* =========================================
   HELPERS
========================================= */
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
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
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function getThumbnail(video) {
  return safeUrl(video.thumbnail) || safeUrl(video.previewThumbnail) || "";
}

/* =========================================
   CARD CREATION
========================================= */
function createVideoCard(video) {
  const videoUrl = safeUrl(video.videoUrl);
  const thumbnail = getThumbnail(video);
  const fallbackThumbnail = safeUrl(video.imageURL);
  const preview = safeUrl(video.preview);

  if (!videoUrl) return null;

  const card = document.createElement("article");
  card.className = "video-card";

  card.innerHTML = `
    <div class="thumbnail-container">
      <img
        class="video-thumbnail"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
      >
      ${preview ? `
        <video
          class="video-preview"
          data-src="${escapeHTML(preview)}"
          muted
          loop
          playsinline
          preload="none"
          hidden
        ></video>
        <button
          class="preview-button"
          type="button"
          aria-label="Play video preview"
        >▶ Preview</button>
      ` : ""}
      ${video.duration ? `<span class="duration">${escapeHTML(video.duration)}</span>` : ""}
    </div>
    <div class="video-info">
      <a
        class="video-title"
        href="${escapeHTML(videoUrl)}"
        target="_blank"
        rel="noopener noreferrer"
      >${escapeHTML(video.title || "Untitled video")}</a>
      <div class="video-meta">
        ${video.views ? `<span>${escapeHTML(video.views)}</span>` : ""}
      </div>
    </div>
  `;

  const img = card.querySelector(".video-thumbnail");
  if (thumbnail) {
    img.src = thumbnail;
    if (fallbackThumbnail && fallbackThumbnail !== thumbnail) {
      img.addEventListener("error", function onError() {
        img.removeEventListener("error", onError);
        img.src = fallbackThumbnail;
      });
    }
  } else {
    img.hidden = true;
  }

  return card;
}

/* =========================================
   PREVIEWS (TOUCH + DESKTOP)
========================================= */
function stopPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;

  if (!activePreview) return;

  const video = activePreview;
  const card = video.closest(".video-card");
  const thumbnail = card?.querySelector(".video-thumbnail");
  const button = card?.querySelector(".preview-button");

  video.pause();
  video.hidden = true;
  video.removeAttribute("src");
  video.load();

  if (thumbnail) thumbnail.hidden = false;
  if (button) {
    button.textContent = "▶ Preview";
    button.setAttribute("aria-label", "Play video preview");
  }

  activePreview = null;
}

async function startPreview(container, manual = false) {
  if (!container) return;
  if (dataSaver.checked && !manual) return;
  if (!manual && !container.matches(":hover")) return;

  const video = container.querySelector(".video-preview");
  const button = container.querySelector(".preview-button");
  const thumbnail = container.querySelector(".video-thumbnail");

  if (!video || !video.dataset.src) return;

  if (manual && activePreview === video && !video.paused) {
    stopPreview();
    return;
  }

  stopPreview();
  activePreview = video;

  if (button) button.textContent = "Loading…";
  video.hidden = false;
  if (thumbnail) thumbnail.hidden = true;

  video.src = video.dataset.src;

  try {
    await video.play();
    if (activePreview !== video) return;

    if (button) {
      button.textContent = "Ⅱ Stop preview";
      button.setAttribute("aria-label", "Stop video preview");
    }

    previewTimer = null;
  } catch {
    if (activePreview === video) {
      stopPreview();
      if (button) button.textContent = "▶ Retry";
    }
  }
}

// Click listener for manual preview button
resultsContainer.addEventListener("click", event => {
  const button = event.target.closest(".preview-button");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  startPreview(button.closest(".thumbnail-container"), true);
});

// Pointer hover listeners
resultsContainer.addEventListener("pointerover", event => {
  if (event.pointerType !== "mouse" || dataSaver.checked) return;
  const container = event.target.closest(".thumbnail-container");
  if (!container || container.contains(event.relatedTarget)) return;

  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    startPreview(container, false);
  }, HOVER_DELAY);
});

resultsContainer.addEventListener("pointerout", event => {
  if (event.pointerType !== "mouse") return;
  const container = event.target.closest(".thumbnail-container");
  if (!container || container.contains(event.relatedTarget)) return;

  clearTimeout(hoverTimer);
  if (activePreview && activePreview.closest(".thumbnail-container") === container) {
    stopPreview();
  }
});

dataSaver.addEventListener("change", () => {
  if (dataSaver.checked) {
    clearTimeout(hoverTimer);
    stopPreview();
  }
});

/* =========================================
   SEARCH & PAGINATION
========================================= */
async function loadPage(reset = false) {
  if (loading) return;
  if (!reset && !hasMore) return;
  if (!currentQuery.trim()) return;

  if (reset) {
    if (searchController) searchController.abort();
    clearTimeout(hoverTimer);
    stopPreview();

    searchController = new AbortController();
    searchId++;
    resultsContainer.replaceChildren();
    seenVideoUrls.clear();

    currentPage = 0;
    hasMore = false;
    resultCount.textContent = "";
    pageIndicator.textContent = "";
  } else if (!searchController || searchController.signal.aborted) {
    searchController = new AbortController();
  }

  const requestId = searchId;
  const controller = searchController;

  loading = true;
  searchButton.disabled = true;
  loadMoreButton.hidden = true;
  statusElement.textContent = "Searching…";

  const nextPage = currentPage + 1;

  try {
    const params = new URLSearchParams({
      q: currentQuery,
      page: String(nextPage)
    });

    const response = await fetch(`/api/search?${params}`, {
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (requestId !== searchId) return;

    if (!Array.isArray(data.results)) {
      throw new Error(data.error || "Invalid response format");
    }

    const fragment = document.createDocumentFragment();
    for (const video of data.results) {
      const url = safeUrl(video.videoUrl);
      if (!url || seenVideoUrls.has(url)) continue;

      const card = createVideoCard(video);
      if (!card) continue;

      seenVideoUrls.add(url);
      fragment.appendChild(card);
    }

    resultsContainer.appendChild(fragment);
    currentPage = nextPage;
    hasMore = data.results.length > 0;

    const total = resultsContainer.children.length;
    resultCount.textContent = `${total} videos`;
    pageIndicator.textContent = `Page ${currentPage}`;

    if (total === 0) {
      statusElement.textContent = "No videos found.";
    } else if (!hasMore) {
      statusElement.textContent = "No more results.";
    } else {
      statusElement.textContent = "";
    }

    loadMoreButton.hidden = !hasMore;
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Search error:", error);

    if (requestId === searchId) {
      statusElement.textContent = "Unable to load videos. Please try again.";
      loadMoreButton.hidden = false;
    }
  } finally {
    if (requestId === searchId) {
      loading = false;
      searchButton.disabled = false;
    }
  }
}

// Form Submission
searchForm.addEventListener("submit", event => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    searchInput.focus();
    return;
  }
  currentQuery = query;
  loadPage(true);
});

// Load more click & Intersection Observer
loadMoreButton.addEventListener("click", () => loadPage());

const observer = new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting) && hasMore && !loading) {
    loadPage();
  }
}, { rootMargin: "350px 0px" });

observer.observe(scrollSentinel);

/* =========================================
   LAYOUT TOGGLE
========================================= */
const savedLayout = localStorage.getItem("videoCardLayout");
const startCompact = savedLayout === "compact";

function applyCardLayout(compact) {
  resultsContainer.classList.toggle("compact-cards", compact);
  resultsContainer.classList.toggle("large-cards", !compact);
  layoutToggle.textContent = compact ? "▦ Bigger" : "▤ Compact";
  layoutToggle.setAttribute("aria-pressed", String(!compact));
  localStorage.setItem("videoCardLayout", compact ? "compact" : "large");
}

applyCardLayout(startCompact);

layoutToggle.addEventListener("click", () => {
  const compact = resultsContainer.classList.contains("compact-cards");
  applyCardLayout(!compact);
});
