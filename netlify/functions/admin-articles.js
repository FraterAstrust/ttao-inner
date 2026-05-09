const { getStore } = require("@netlify/blobs");
const jwt = require("jsonwebtoken");

function verifyAdmin(event) {
  const cookieHeader = event.headers.cookie || "";
  const match = cookieHeader.match(/ttao_admin=([^;]+)/);
  if (!match) return null;
  try {
    return jwt.verify(match[1], process.env.JWT_ADMIN_SECRET);
  } catch { return null; }
}

function getStore_() {
  return getStore({
    name: "articles",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Backward compat: items without contentType are treated as 'articles'
function normalizeType(item) {
  return item.contentType || "articles";
}

exports.handler = async (event) => {
  const admin = verifyAdmin(event);
  if (!admin) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const store = getStore_();
  const method = event.httpMethod;
  const { id, contentType } = event.queryStringParameters || {};

  try {
    if (method === "GET") {
      if (id) {
        const item = await store.get(id, { type: "json" });
        if (!item) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
        return { statusCode: 200, body: JSON.stringify(item) };
      }

      const { blobs } = await store.list();
      const all = await Promise.all(blobs.map(async b => {
        const data = await store.get(b.key, { type: "json" });
        return { id: b.key, ...data };
      }));

      const filtered = contentType
        ? all.filter(a => normalizeType(a) === contentType)
        : all;

      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return { statusCode: 200, body: JSON.stringify(filtered) };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body);
      const {
        title, content, tier = "tyro", published = false,
        contentType: ct = "articles",
        moduleNumber, bulletinNumber, glyph,
      } = body;

      if (!title || !content) {
        return { statusCode: 400, body: JSON.stringify({ error: "title and content required" }) };
      }

      const prefix = ct !== "articles" ? `${ct}-` : "";
      const newId = prefix + slugify(title) + "-" + Date.now();
      const now = new Date().toISOString();
      const item = {
        id: newId, title, content, tier, published, contentType: ct,
        ...(moduleNumber  && { moduleNumber }),
        ...(bulletinNumber && { bulletinNumber }),
        ...(glyph         && { glyph }),
        createdAt: now, updatedAt: now,
      };
      await store.setJSON(newId, item);
      return { statusCode: 201, body: JSON.stringify(item) };
    }

    if (method === "PUT") {
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id required" }) };
      const existing = await store.get(id, { type: "json" });
      if (!existing) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
      const body = JSON.parse(event.body);
      const updated = { ...existing, ...body, id, updatedAt: new Date().toISOString() };
      await store.setJSON(id, updated);
      return { statusCode: 200, body: JSON.stringify(updated) };
    }

    if (method === "DELETE") {
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id required" }) };
      await store.delete(id);
      return { statusCode: 200, body: JSON.stringify({ deleted: id }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("admin-articles error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
