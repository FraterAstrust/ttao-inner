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

function extractExcerpt(content, maxLen = 180) {
  const stripped = content
    .replace(/^\[gate:[^\]]+\]\s*/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\n+/g, " ")
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + "…" : stripped;
}

exports.handler = async (event) => {
  const session = verifySession(event);
  if (!session) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const userRank = TIER_RANK[session.tier] ?? 0;
  const id = event.queryStringParameters?.id;

  const store = getStore({
    name: "articles",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });

  try {
    // Single article — return full content for client-side gate rendering
    if (id) {
      const article = await store.get(id, { type: "json" });
      if (!article || !article.published) {
        return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
      }
      if ((TIER_RANK[article.tier] ?? 0) > userRank) {
        return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
      }
      return { statusCode: 200, body: JSON.stringify(article) };
    }

    // List — return metadata + excerpt only (no full content)
    const { blobs } = await store.list();
    const articles = await Promise.all(
      blobs.map(async (b) => {
        const data = await store.get(b.key, { type: "json" });
        return { id: b.key, ...data };
      })
    );

    const visible = articles
      .filter(a => a.published && (TIER_RANK[a.tier] ?? 0) <= userRank)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(({ content, ...meta }) => ({ ...meta, excerpt: extractExcerpt(content) }));

    return { statusCode: 200, body: JSON.stringify(visible) };
  } catch (err) {
    console.error("Articles error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};