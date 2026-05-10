const { getStore } = require("@netlify/blobs");
const jwt = require("jsonwebtoken");

function verifyAdmin(event) {
  const cookieHeader = event.headers.cookie || "";
  const match = cookieHeader.match(/ttao_admin=([^;]+)/);
  if (!match) return null;
  try { return jwt.verify(match[1], process.env.JWT_ADMIN_SECRET); }
  catch { return null; }
}

function getContentStore() {
  return getStore({
    name: "articles",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  const admin = verifyAdmin(event);
  if (!admin) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const method = event.httpMethod;
  const store = getContentStore();

  try {
    // ── EXPORT: GET ──
    if (method === "GET") {
      const { blobs } = await store.list();
      const content = await Promise.all(
        blobs.map(async (b) => {
          const data = await store.get(b.key, { type: "json" });
          return { id: b.key, ...data };
        })
      );
      content.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: admin.email || admin.userId,
        version: "1.0",
        itemCount: content.length,
        content,
      };

      const date = new Date().toISOString().split("T")[0];
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="ttao-backup-${date}.json"`,
        },
        body: JSON.stringify(exportData, null, 2),
      };
    }

    // ── IMPORT: POST ──
    if (method === "POST") {
      const body = JSON.parse(event.body);

      if (!body.content || !Array.isArray(body.content)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid backup format. Expected { content: [...] }" }) };
      }

      const { mode = "merge" } = body; // "merge" keeps existing, "replace" overwrites all

      // If replace mode, delete everything first
      if (mode === "replace") {
        const { blobs } = await store.list();
        await Promise.all(blobs.map((b) => store.delete(b.key)));
      }

      let imported = 0;
      const errors = [];

      for (const item of body.content) {
        try {
          const { id, ...data } = item;
          if (!id) { errors.push("Item missing id — skipped"); continue; }
          await store.setJSON(id, { ...data, updatedAt: new Date().toISOString() });
          imported++;
        } catch (err) {
          errors.push(`Failed to import ${item.id || "unknown"}: ${err.message}`);
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ imported, errors, mode }),
      };
    }

    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("Export error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
