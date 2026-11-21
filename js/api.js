/* ----------------------------------------------------------------------
   TsHlog API layer — resilient multi-endpoint fetcher.
   Reddit public JSON is used, but with fallbacks:
     1) www.reddit.com/...json
     2) old.reddit.com/...json
     3) api.pullpush.io (archive mirror, CORS-friendly, no auth)
   Every call returns [] instead of throwing where possible.
   ---------------------------------------------------------------------- */

const PROXYLESS_HOSTS = [
  "https://www.reddit.com/r/",
  "https://old.reddit.com/r/"
];

function withLimit(base, sort, limit) {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sort}.json${sep}limit=${limit}&raw_json=1`;
}

async function tryFetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      redirect: "follow"
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.data || !Array.isArray(data.data.children)) return null;
    return data.data.children;
  } catch (_) {
    return null;
  }
}

async function fetchSubreddit(sub, sort = "hot", limit = TSHLOG_CONFIG.redditLimit) {
  // 1 + 2: direct Reddit endpoints
  for (const host of PROXYLESS_HOSTS) {
    const children = await tryFetchJson(withLimit(host + sub, sort, limit));
    if (children && children.length) {
      const mapped = children.map(normalizeRedditPost).filter(Boolean);
      if (mapped.length) return mapped;
    }
  }

  // 3: pullpush archive fallback
  try {
    const pp = `https://api.pullpush.io/reddit/search/submission/?subreddit=${encodeURIComponent(
      sub
    )}&size=${limit}&nsfw=true&sort=desc&sort_type=score`;
    const res = await fetch(pp, { headers: { "Accept": "application/json" } });
    if (res.ok) {
      const j = await res.json();
      const mapped = (j?.data || []).map(normalizePullPush).filter(Boolean);
      if (mapped.length) return mapped;
    }
  } catch (_) {}

  return [];
}

async function fetchRandomFromSubs(subs, count = 6) {
  // Shuffle and pull small batches in parallel; stop when we have enough.
  const shuffled = [...subs].sort(() => Math.random() - 0.5);
  const out = [];
  for (const sub of shuffled) {
    if (out.length >= count) break;
    const batch = await fetchSubreddit(sub, "random", 25);
    for (const item of batch) {
      if (out.length >= count) break;
      out.push(item);
    }
  }
  return out;
}

function normalizeRedditPost(child) {
  const p = child?.data;
  if (!p) return null;

  let mediaUrl = null;
  let type = "video";

  if (p.secure_media?.reddit_video?.fallback_url) {
    mediaUrl = p.secure_media.reddit_video.fallback_url;
  } else if (p.preview?.reddit_video_preview?.fallback_url) {
    mediaUrl = p.preview.reddit_video_preview.fallback_url;
  } else if (p.url && /\.(mp4)$/i.test(p.url)) {
    mediaUrl = p.url;
  } else if (p.url && /(gifv|imgur)/i.test(p.url)) {
    mediaUrl = p.url.replace(/\.gifv?$/i, ".mp4").replace("imgur.com", "i.imgur.com");
    if (!/\.(mp4|gif)$/i.test(mediaUrl)) mediaUrl = p.url;
    type = "gif";
  } else if (p.url && /\.(gif|jpe?g|png)$/i.test(p.url)) {
    mediaUrl = p.url;
    type = "image";
  }

  if (!mediaUrl) return null;

  const thumb =
    (p.thumbnail && p.thumbnail.startsWith("http") && p.thumbnail) ||
    p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&") ||
    "";

  const sub = p.subreddit || "unknown";
  const tags = [sub, ...(p.link_flair_text ? [p.link_flair_text] : [])]
    .filter(Boolean)
    .slice(0, 4);

  return {
    id: p.id,
    title: (p.title || sub).slice(0, 90),
    media: mediaUrl,
    thumb: thumb.startsWith("http") ? thumb : "",
    type,
    tags,
    subreddit: sub,
    permalink: p.permalink ? `https://www.reddit.com${p.permalink}` : ""
  };
}

function normalizePullPush(sub) {
  if (!sub?.url || !/\.(mp4|gif|gifv|jpe?g|png)$/i.test(sub.url)) return null;
  const type = /\.mp4$/i.test(sub.url) ? "video"
             : /\.(gif|gifv)$/i.test(sub.url) ? "gif" : "image";
  return {
    id: sub.id,
    title: (sub.title || sub.subreddit || "").slice(0, 90),
    media: sub.url,
    thumb: sub.thumbnail?.startsWith("http") ? sub.thumbnail : "",
    type,
    tags: [sub.subreddit].filter(Boolean),
    subreddit: sub.subreddit,
    permalink: sub.permalink ? `https://www.reddit.com${sub.permalink}` : ""
  };
}

/* ----------------------------------------------------------------------
   Search: fetch several subs matching a tag and filter by keyword.
   ---------------------------------------------------------------------- */
async function searchByTags(tagString) {
  const words = tagString
    .split(/[\s,+]+/)
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);
  if (!words.length) return [];

  // Try subs whose name matches the first word, plus a generic pool.
  const candidateSubs = TSHLOG_CONFIG.subreddits.filter(
    s => words.some(w => s.toLowerCase().includes(w)) ||
         (TSHLOG_CONFIG.categorySubs && TSHLOG_CONFIG.categorySubs[s]?.some(w => words.includes(w)))
  );
  const pool = [...new Set([...candidateSubs, ...TSHLOG_CONFIG.subreddits])].slice(0, 6);

  const results = [];
  for (const sub of pool) {
    const batch = await fetchSubreddit(sub, "hot", 40);
    for (const item of batch) {
      const hay = `${item.title} ${item.tags.join(" ")}`.toLowerCase();
      if (words.every(w => hay.includes(w))) results.push(item);
      if (results.length >= 48) break;
    }
    if (results.length >= 48) break;
  }
  return results;
}
