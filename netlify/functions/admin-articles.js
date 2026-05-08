const { getStore } = require("@netlify/blobs");
const jwt = require("jsonwebtoken");

function verifyAdmin(event) {
  const cookieHeader = event.headers.cookie || "";
  const match = cookieHeader.match(/ttao_admin=([^;]+)/);
  if (!match) return null;
  try {
    return jwt.verify(match[1], process.env.JWT_ADMIN_SECRET);
  } catch {
    return null;
  }
}

function getArticlesStore() {
  return getStore({
    name: "articles",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

exports.handler = async (event) => {
  const admin = verifyAdmin(event);
  if (!admin) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const store = getArticlesStore();
  const method = event.httpMethod;
  const id = event.queryStringParameters?.id;

  try {
    if (method === "GET") {
      if (id) {
        const article = await store.get(id, { type: "json" });
        if (!article) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
        return { statusCode: 200, body: JSON.stringify(article) };
      }
      const { blobs } = await store.list();
      const articles = await Promise.all(
        blobs.map(async (b) => {
          const data = await store.get(b.key, { type: "json" });
          return { id: b.key, ...data };
        })
      );
      articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return { statusCode: 200, body: JSON.stringify(articles) };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body);
      const { title, content, tier = "tyro", published = false } = body;
      if (!title || !content) {
        return { statusCode: 400, body: JSON.stringify({ error: "title and content required" }) };
      }
      const newId = slugify(title) + "-" + Date.now();
      const article = {
        id: newId, title, content, tier, published,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(newId, article);
      return { statusCode: 201, body: JSON.stringify(article) };
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
    console.error("Articles function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
