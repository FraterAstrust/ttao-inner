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

function getStudentsStore() {
  return getStore({
    name: "students",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  const admin = verifyAdmin(event);
  if (!admin) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const store = getStudentsStore();
  const method = event.httpMethod;

  try {
    if (method === "GET") {
      const { blobs } = await store.list();
      const students = await Promise.all(
        blobs.map(async (b) => {
          const data = await store.get(b.key, { type: "json" });
          return { id: b.key, ...data };
        })
      );
      students.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
      return { statusCode: 200, body: JSON.stringify(students) };
    }

    if (method === "PUT") {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, body: JSON.stringify({ error: "id required" }) };
      const existing = await store.get(id, { type: "json" });
      if (!existing) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
      const { tier } = JSON.parse(event.body);
      const updated = { ...existing, tier, tierOverride: true, updatedAt: new Date().toISOString() };
      await store.setJSON(id, updated);
      return { statusCode: 200, body: JSON.stringify(updated) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (err) {
    console.error("Students function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
