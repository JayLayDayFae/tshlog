/* ----------------------------------------------------------------------
   TsHlog front-end controller.
   Works on index.html AND search.html by feature-detecting element IDs.
   Always renders *something*: skeleton cards, error notices, retries.
   ---------------------------------------------------------------------- */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

let HERO_ITEMS = [];
let HERO_INDEX = 0;
let CURRENT_TAGS = [];

/* ---------- rendering helpers ---------- */

function makeCard(item) {
  const el = document.createElement("div");
  el.className = "video-card";

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = item.title;
  img.src = item.thumb || fallbackThumb(item);
  img.onerror = () => { img.src = fallbackThumb(item); };

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = item.title;

  const tagWrap = document.createElement("div");
  tagWrap.className = "tags";
  item.tags.forEach(t => {
    const s = document.createElement("span");
    s.textContent = t;
    s.onclick = e => {
      e.stopPropagation();
      location.href = `search.html?q=${encodeURIComponent(t)}`;
    };
    tagWrap.appendChild(s);
  });
  meta.appendChild(tagWrap);

  el.appendChild(img);
  el.appendChild(meta);
  el.onclick = () => openModal(item);
  return el;
}

function fallbackThumb(item) {
  // Inline SVG placeholder with the sub name, no external dep
  const label = (item.subreddit || "TsHlog").slice(0, 18);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'>
    <rect width='100%' height='100%' fill='%230a1a3c'/>
    <text x='50%' y='50%' fill='%236fd3ff' font-size='16'
      font-family='sans-serif' text-anchor='middle' dominant-baseline='middle'>${label}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + svg;
}

function renderGrid(container, items) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="loading">No results — try another tag or hit refresh.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach(it => frag.appendChild(makeCard(it)));
  container.appendChild(frag);
}

function skeleton(container, n = 6) {
  container.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "video-card";
    d.innerHTML = `<div class="loading">…</div>`;
    container.appendChild(d);
  }
}

/* ---------- modal player ---------- */

function openModal(item) {
  closeModal();
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.onclick = e => { if (e.target === modal) closeModal(); };

  const inner = document.createElement("div");
  inner.className = "modal-inner";

  const close = document.createElement("span");
  close.className = "close";
  close.textContent = "×";
  close.onclick = closeModal;

  if (item.type === "video") {
    const v = document.createElement("video");
    v.src = item.media;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.onerror = () => {
      v.outerHTML = `<div class="loading">Video can't be embedded. <a href="${item.media}" target="_blank" rel="noopener" style="color:#6fd3ff">Open source ↗</a></div>`;
    };
    inner.appendChild(v);
  } else {
    const img = document.createElement("img");
    img.src = item.media;
    img.style.objectFit = "contain";
    inner.appendChild(img);
  }

  inner.appendChild(close);
  modal.appendChild(inner);
  document.body.appendChild(modal);
}

function closeModal() {
  const m = $(".modal");
  if (m) m.remove();
}

document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ---------- hero (Wii main channel) ---------- */

async function buildHero() {
  const screen = $("#heroPlayer");
  const tagsEl = $("#heroTags");
  if (!screen) return;

  HERO_ITEMS = await fetchRandomFromSubs(TSHLOG_CONFIG.subreddits, TSHLOG_CONFIG.heroPull);
  HERO_INDEX = 0;
  showHero();

  $("#heroRefresh").onclick = () => {
    HERO_INDEX = (HERO_INDEX + 1) % Math.max(HERO_ITEMS.length, 1);
    showHero();
  };
  $("#heroRandom").onclick = () => {
    if (!HERO_ITEMS.length) return;
    const pick = HERO_ITEMS[Math.floor(Math.random() * HERO_ITEMS.length)];
    openModal(pick);
  };
}

function showHero() {
  const screen = $("#heroPlayer");
  const tagsEl = $("#heroTags");
  if (!screen) return;
  const item = HERO_ITEMS[HERO_INDEX];
  screen.innerHTML = "";
  tagsEl.innerHTML = "";

  if (!item) {
    screen.innerHTML = `<div class="loading" style="height:100%">Couldn't reach any source. Refresh the page.</div>`;
    return;
  }

  const img = document.createElement("img");
  img.src = item.thumb || fallbackThumb(item);
  img.alt = item.title;
  img.style.objectFit = "cover";
  img.onerror = () => { img.src = fallbackThumb(item); };
  screen.appendChild(img);

  const overlay = document.createElement("div");
  overlay.className = "hero-overlay";
  const tagWrap = document.createElement("div");
  tagWrap.className = "hero-tags";
  item.tags.forEach(t => {
    const s = document.createElement("span");
    s.textContent = t;
    s.onclick = e => { e.stopPropagation(); location.href = `search.html?q=${encodeURIComponent(t)}`; };
    tagWrap.appendChild(s);
  });
  const controls = document.createElement("div");
  controls.className = "hero-controls";
  const btnR = document.createElement("button");
  btnR.textContent = "🎲 Random Video";
  btnR.onclick = e => { e.stopPropagation(); openModal(item); };
  controls.appendChild(btnR);
  overlay.appendChild(tagWrap);
  overlay.appendChild(controls);
  screen.appendChild(overlay);

  screen.onclick = () => openModal(item);
}

/* ---------- home categories ---------- */

function buildCategories() {
  const grid = $("#catGrid");
  if (!grid) return;
  Object.keys(TSHLOG_CONFIG.categories).forEach(label => {
    const card = document.createElement("div");
    card.className = "cat-card";
    card.textContent = label;
    card.onclick = () => {
      const sub = TSHLOG_CONFIG.categories[label];
      location.href = `search.html?q=${encodeURIComponent(sub)}`;
    };
    grid.appendChild(card);
  });
}

/* ---------- home feed ---------- */

async function buildFeed() {
  const grid = $("#videoGrid");
  if (!grid) return;
  skeleton(grid, 8);
  const items = await fetchRandomFromSubs(TSHLOG_CONFIG.subreddits, TSHLOG_CONFIG.feedSize);
  renderGrid(grid, items);
}

/* ---------- search page ---------- */

async function runSearch(tagString) {
  const grid = $("#videoGrid");
  const title = $("#resultsTitle");
  if (!grid) return;

  CURRENT_TAGS = tagString.split(/[\s,+]+/).filter(Boolean);
  if (title) title.textContent = CURRENT_TAGS.length ? `Results for: ${CURRENT_TAGS.join(", ")}` : "Search";

  if (!$("#tagChips").children.length) {
    TSHLOG_CONFIG.subreddits.slice(0, 10).forEach(t => {
      const chip = document.createElement("span");
      chip.textContent = t;
      chip.onclick = () => {
        const input = $("#searchInput");
        if (input) input.value = t;
        runSearch(t);
        $$("#tagChips span").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
      };
      $("#tagChips").appendChild(chip);
    });
  }

  if (!CURRENT_TAGS.length) { grid.innerHTML = ""; return; }

  skeleton(grid, 6);
  const items = await searchByTags(tagString);
  renderGrid(grid, items);
}

function wireSearchPage() {
  if (!$("#searchForm")) return;
  const q = new URLSearchParams(location.search).get("q") || "";
  const input = $("#searchInput");
  if (input && q) input.value = q;
  $("#searchForm").onsubmit = e => {
    e.preventDefault();
    const val = input.value.trim();
    history.replaceState(null, "", `?q=${encodeURIComponent(val)}`);
    runSearch(val);
  };
  if (q) runSearch(q);
}

/* ---------- boot ---------- */

window.addEventListener("DOMContentLoaded", () => {
  if ($("#heroPlayer")) {
    buildCategories();
    buildHero();
    buildFeed();
  }
  wireSearchPage();
});
