/* ----------------------------------------------------------------------
   TsHlog API layer
   Uses Reddit's public JSON endpoints (no key required) plus a small
   PornHub/RedGifs style shuffler. Everything is fetched client-side.
   ---------------------------------------------------------------------- */

// Fetch a subreddit's hot/random media using Reddit's public .json API
async function fetchSubreddit(sub, sort = "hot", limit = TSHLOG_CONFIG.redditLimit) {
  const url = `${TSHLOG_CONFIG.redditBase}${sub}/${sort}.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Reddit ${res.status} for r/${sub}`);
  const data = await res.json();
  return (data.data.children || []).map(normalizeRedditPost).filter(Boolean);
}

function normalizeRedditPost(child) {
  const p = child.data;
  if (!p) return null;

  // Prefer mp4 / gifv source
  let mediaUrl = null;
  if (p.secure_media?.reddit_video?.fallback_url) {
    mediaUrl = p.secure_media.reddit_video.fallback_url;
  } else if (p.preview?.reddit_video_preview?.fallback_url) {
    mediaUrl = p.preview.reddit_video_preview.fallback_url;
  } else if (p.url && /\.(mp4|gif|gifv)$/i.test(p.url)) {
    mediaUrl = p.url;
  } else if (p.url && /imgur\.com/i.test(p.url)) {
    mediaUrl = p.url.replace(/\.gifv$/i, ".gif");
  }

  if (!mediaUrl) return null;

  const thumb =
    p.thumbnail && p.thumbnail.startsWith("http") ? p.thumbnail :
    p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&") ?? "";

  return {
