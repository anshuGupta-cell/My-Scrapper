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
let hoverTimer;
let previewTimer;
let searchController;
let searchId = 0;
let activePreview = null;

const seenVideoUrls = new Set();

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

    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

// Keep the original URL because the server may already
// provide a small 526x298 thumbnail.
function getThumbnail(video) {
  return safeUrl(video.thumbnail) ||
         safeUrl(video.previewThumbnail) ||
         "";
}

function createVideoCard(video) {
  const videoUrl = safeUrl(video.videoUrl);
  const thumbnail = getThumbnail(video);
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
      >${escapeHTML(video.title || "Untitled video")}</a>

      <div class="video-meta">
        ${video.views ? `<span>${escapeHTML(video.views)}</span>` : ""}
      </div>
    </div>
  `;

  const img = card.querySelector(".video-thumbnail");

  if (thumbnail) {
    img.src = thumbnail;

    // Fall back to the original image URL if the thumbnail fails.
    const fallback = safeUrl(video.imageURL);

    if (fallback && fallback !== thumbnail) {
      img.addEventListener("error", function onError() {
        img.removeEventListener("error", onError);
        img.src = fallback;
      });
    }
  } else {
    img.hidden = true;
  }

  return card;
}

function stopPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;

  if (!activePreview) return;

  const video = activePreview;

  video.pause();
  video.hidden = true;
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

  try {
    await video.play();

    if (activePreview !== video) return;

    previewTimer = setTimeout(() => {
      stopPreview();
    }, MAX_PREVIEW_SECONDS * 1000);
  } catch (error) {
    if (activePreview === video) {
      stopPreview();
    }
  }
}

// Hover preview on desktop.
resultsContainer.addEventListener("pointerover", event => {
  if (event.pointerType !== "mouse" || dataSaver.checked) return;

  const container = event.target.closest(".thumbnail-container");

  if (!container || container.contains(event.relatedTarget)) return;

  clearTimeout(hoverTimer);

  hoverTimer = setTimeout(() => {
    startPreview(container);
  }, HOVER_DELAY);
});

resultsContainer.addEventListener("pointerout", event => {
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

// Data Saver prevents preview downloads.
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
      throw new Error(`HTTP ${response.status}`);
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

    resultCount.textContent =
      `${resultsContainer.children.length} videos loaded`;

    pageIndicator.textContent = `Page ${currentPage}`;

    statusElement.textContent = hasMore
      ? ""
      : resultsContainer.children.length
        ? "No more results."
        : "No videos found.";

    loadMoreButton.hidden = !hasMore;
  } catch (error) {
    if (error.name === "AbortError") return;

    console.error("Search error:", error);

    if (requestId === searchId) {
      statusElement.textContent =
        "Unable to load results. Please try again.";

      loadMoreButton.hidden = false;
    }
  } finally {
    if (requestId === searchId) {
      loading = false;
      searchButton.disabled = false;
    }
  }
}

searchForm.addEventListener("submit", event => {
  event.preventDefault();

  const query = searchInput.value.trim();

  if (!query) return;

  currentQuery = query;
  loadPage(true);
});

loadMoreButton.addEventListener("click", () => {
  loadPage();
});

// Infinite scrolling.
const observer = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting) && hasMore && !loading) {
    loadPage();
  }
}, {
  rootMargin: "350px 0px"
});

observer.observe(scrollSentinel);
