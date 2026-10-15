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

let currentQuery = "";
let currentPage = 0;
let totalResults = 0;
let loading = false;
let hasMore = false;
let searchController = null;

const seenVideoUrls = new Set();
const activePreviews = new Set();

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function validHttpUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value, window.location.origin);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function createVideoCard(video) {
  const videoUrl = validHttpUrl(video.videoUrl);
  const thumbnail = validHttpUrl(video.thumbnail);
  const preview = validHttpUrl(video.preview);

  if (!videoUrl) return null;

  const card = document.createElement("article");
  card.className = "video-card";

  card.innerHTML = `
    <div class="thumbnail-container">
      ${
        thumbnail
          ? `<img
              src="${escapeHTML(thumbnail)}"
              alt="${escapeHTML(video.title || "Video thumbnail")}"
              loading="lazy"
              decoding="async"
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
            ></video>
            <span class="preview-indicator">PREVIEW</span>`
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

function stopPreview(container) {
  const video = container.querySelector(".video-preview");

  if (!video) return;

  video.pause();
  video.hidden = true;

  // Release the downloaded preview when data saver is enabled.
  if (dataSaver.checked) {
    video.removeAttribute("src");
    video.load();
  }

  activePreviews.delete(video);
}

async function startPreview(container) {
  if (dataSaver.checked && !container.matches(":hover")) {
    return;
  }

  const video = container.querySelector(".video-preview");

  if (!video) return;

  const source = video.dataset.src;

  if (!source) return;

  // Avoid starting the same preview twice.
  if (video.dataset.loading === "true") return;

  // Stop other previews to limit simultaneous downloads.
  for (const activeVideo of activePreviews) {
    if (activeVideo !== video) {
      const otherContainer = activeVideo.closest(".thumbnail-container");

      if (otherContainer) stopPreview(otherContainer);
    }
  }

  if (!video.getAttribute("src")) {
    video.dataset.loading = "true";
    video.src = source;
    video.load();
  }

  video.hidden = false;
  activePreviews.add(video);

  try {
    await video.play();
  } catch {
    video.hidden = true;
  } finally {
    video.dataset.loading = "false";
  }
}

// Desktop hover preview.
resultsContainer.addEventListener("pointerover", (event) => {
  if (event.pointerType !== "mouse") return;

  const container = event.target.closest(".thumbnail-container");

  if (!container || container.contains(event.relatedTarget)) return;

  startPreview(container);
});

resultsContainer.addEventListener("pointerout", (event) => {
  if (event.pointerType !== "mouse") return;

  const container = event.target.closest(".thumbnail-container");

  if (!container || container.contains(event.relatedTarget)) return;

  stopPreview(container);
});

// Clicking the thumbnail on mobile toggles preview playback.
resultsContainer.addEventListener("click", (event) => {
  const container = event.target.closest(".thumbnail-container");

  if (!container) return;

  if (event.target.closest("a")) return;

  if (event.pointerType === "mouse") return;

  const video = container.querySelector(".video-preview");

  if (!video) return;

  if (!video.paused) {
    stopPreview(container);
  } else {
    startPreview(container);
  }
});

function stopAllPreviews() {
  document.querySelectorAll(".thumbnail-container").forEach((container) => {
    stopPreview(container);
  });
}

dataSaver.addEventListener("change", () => {
  if (dataSaver.checked) {
    stopAllPreviews();
  }
});

async function loadPage({ reset = false } = {}) {
  if (loading) return;

  if (!reset && !hasMore) return;

  if (reset) {
    if (searchController) searchController.abort();

    stopAllPreviews();
    resultsContainer.replaceChildren();
    seenVideoUrls.clear();

    currentPage = 0;
    totalResults = 0;
    hasMore = false;

    searchController = new AbortController();
  }

  loading = true;
  searchButton.disabled = true;
  loadMoreButton.hidden = true;
  statusElement.textContent = "Loading videos...";

  const requestedPage = currentPage + 1;

  try {
    const params = new URLSearchParams({
      q: currentQuery,
      page: String(requestedPage)
    });

    const response = await fetch(`/api/search?${params}`, {
      signal: searchController.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const data = await response.json();

    if (!Array.isArray(data.results)) {
      throw new Error(data.error || "Unexpected API response.");
    }

    let added = 0;

    const fragment = document.createDocumentFragment();

    for (const video of data.results) {
      if (!video.videoUrl || seenVideoUrls.has(video.videoUrl)) {
        continue;
      }

      seenVideoUrls.add(video.videoUrl);

      const card = createVideoCard(video);

      if (card) {
        fragment.appendChild(card);
        added++;
      }
    }

    resultsContainer.appendChild(fragment);

    currentPage = requestedPage;
    totalResults += added;

    resultCount.textContent = `${totalResults} videos loaded`;
    pageIndicator.textContent = `Page ${currentPage}`;

    hasMore = data.results.length > 0;

    if (added === 0 && data.results.length === 0) {
      statusElement.textContent = "No more videos found.";
    } else {
      statusElement.textContent = "";
    }

    loadMoreButton.hidden = !hasMore;
  } catch (error) {
    if (error.name === "AbortError") return;

    console.error("Search error:", error);

    statusElement.textContent =
      "Unable to load videos. Check your connection and try again.";

    loadMoreButton.hidden = false;
  } finally {
    loading = false;
    searchButton.disabled = false;
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = searchInput.value.trim();

  if (!query) return;

  currentQuery = query;

  await loadPage({ reset: true });
});

loadMoreButton.addEventListener("click", () => {
  loadPage();
});

// Automatically load another page as the user scrolls.
const observer = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting) && hasMore && !loading) {
      loadPage();
    }
  },
  {
    rootMargin: "500px 0px"
  }
);

observer.observe(scrollSentinel);
