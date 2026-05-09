const { getStore } = require("@netlify/blobs");
const jwt = require("jsonwebtoken");

const TIER_RANK = { tyro: 0, initiate: 1, adept: 2 };

function verifySession(event) {
  const cookieHeader = event.headers.cookie || "";
  const match = cookieHeader.match(/ttao_session=([^;]+)/);
  if (!match) return null;
  try {
    return jwt.verify(match[1], process.env.JWT_SECRET);
  } catch { return null; }
}

function normalizeType(item) {
  return item.contentType || "articles";
}

function extractExcerpt(content, maxLen = 180) {
  return content
    .replace(/^\[gate:[^\]]+\]\s*/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, maxLen)
    .replace(/\s\S*$/, "…");
}

exports.handler = async (event) => {
  const session = verifySession(event);
  if (!session) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const userRank = TIER_RANK[session.tier] ?? 0;
  const { id, contentType = "articles" } = event.queryStringParameters || {};

  const store = getStore({
    name: "articles",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    // Single item — return full content for client-side gate rendering
    if (id) {
      const item = await store.get(id, { type: "json" });
      if (!item || !item.published) {
        return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
      }
      if ((TIER_RANK[item.tier] ?? 0) > userRank) {
        return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
      }
      return { statusCode: 200, body: JSON.stringify(item) };
    }

    // List — metadata + excerpt, filtered by contentType and user tier
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map(async b => {
      const data = await store.get(b.key, { type: "json" });
      return { id: b.key, ...data };
    }));

    const visible = all
      .filter(a =>
        a.published &&
        normalizeType(a) === contentType &&
        (TIER_RANK[a.tier] ?? 0) <= userRank
      )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(({ content, ...meta }) => ({ ...meta, excerpt: extractExcerpt(content) }));

    return { statusCode: 200, body: JSON.stringify(visible) };
  } catch (err) {
    console.error("articles error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
