const jwt = require("jsonwebtoken");
const { getStore } = require("@netlify/blobs");

function getAdminIds() {
  const raw = process.env.PATREON_ADMIN_IDS || "";
  return raw.split(",").map(id => id.trim()).filter(Boolean);
}

function getTier(amountCents, userId) {
  if (getAdminIds().includes(userId)) return "adept";
  if (amountCents >= 3300) return "patron";
  if (amountCents >= 1500) return "adept";
  if (amountCents >= 500)  return "initiate";
  return "tyro";
}

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  if (error || !code) {
    return {
      statusCode: 302,
      headers: { Location: "/?auth=denied" },
      body: "",
    };
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://www.patreon.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PATREON_CLIENT_SECRET,
        redirect_uri: process.env.PATREON_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return {
        statusCode: 302,
        headers: { Location: "/?auth=failed" },
        body: "",
      };
    }

    // Fetch identity + memberships
    const identityRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity?fields%5Buser%5D=full_name,email&include=memberships&fields%5Bmember%5D=currently_entitled_amount_cents,patron_status",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }
    );

    const identity = await identityRes.json();
    const user = identity.data;

    if (!user || !user.id) {
      console.error("Identity fetch failed:", JSON.stringify(identity));
      return {
        statusCode: 302,
        headers: { Location: "/?auth=identity_failed" },
        body: "",
      };
    }

    const memberships = identity.included || [];

    // Find active membership and determine tier
    const activeMembership = memberships.find(
      (m) =>
        m.type === "member" &&
        m.attributes.patron_status === "active_patron"
    );

    const amountCents = activeMembership
      ? activeMembership.attributes.currently_entitled_amount_cents
      : 0;

    const tier = getTier(amountCents, user.id);

    // Register or update student record in Blobs
    try {
      const store = getStore({
        name: "students",
        siteID: process.env.NETLIFY_SITE_ID,
        token: process.env.NETLIFY_TOKEN,
      });
      const existing = await store.get(user.id, { type: "json" }).catch(() => null);
      await store.setJSON(user.id, {
        userId: user.id,
        email: user.attributes?.email,
        name: user.attributes?.full_name,
        tier,
        tierOverride: existing?.tierOverride || false,
        firstSeen: existing?.firstSeen || new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
    } catch (blobErr) {
      console.error("Blob write error:", blobErr);
      // Non-fatal — continue with auth
    }

    // Sign JWT
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.attributes?.email,
        name: user.attributes?.full_name,
        tier,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return {
      statusCode: 302,
      headers: {
        Location: "/dashboard",
        "Set-Cookie": `ttao_session=${token}; Path=/; Secure; SameSite=Lax; Max-Age=604800`,
      },
      body: "",
    };
  } catch (err) {
    console.error("Auth error:", err);
    return {
      statusCode: 302,
      headers: { Location: "/?auth=error" },
      body: "",
    };
  }
};
