const jwt = require("jsonwebtoken");

// Only these Patreon IDs can access the admin panel
const ADMIN_IDS = ["57190794"];

exports.handler = async (event) => {
  const { code, error } = event.queryStringParameters || {};

  // Step 1: No code = redirect to Patreon OAuth
  if (!code && !error) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.PATREON_CLIENT_ID,
      redirect_uri: process.env.PATREON_REDIRECT_URI_ADMIN,
      scope: "identity identity[email]",
      state: "admin",
    });
    return {
      statusCode: 302,
      headers: { Location: `https://www.patreon.com/oauth2/authorize?${params}` },
      body: "",
    };
  }

  if (error || !code) {
    return {
      statusCode: 302,
      headers: { Location: "/admin?error=denied" },
      body: "",
    };
  }

  // Step 2: Exchange code for token
  try {
    const tokenRes = await fetch("https://www.patreon.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PATREON_CLIENT_SECRET,
        redirect_uri: process.env.PATREON_REDIRECT_URI_ADMIN,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return { statusCode: 302, headers: { Location: "/admin?error=token_failed" }, body: "" };
    }

    // Step 3: Fetch identity
    const identityRes = await fetch(
      "https://www.patreon.com/api/oauth2/v2/identity?fields%5Buser%5D=full_name,email",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    const identity = await identityRes.json();
    const user = identity.data;

    if (!user || !user.id) {
      return { statusCode: 302, headers: { Location: "/admin?error=identity_failed" }, body: "" };
    }

    // Step 4: Check admin whitelist
    if (!ADMIN_IDS.includes(user.id)) {
      return { statusCode: 302, headers: { Location: "/admin?error=unauthorized" }, body: "" };
    }

    // Step 5: Issue admin JWT
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.attributes?.email,
        name: user.attributes?.full_name,
        role: "admin",
      },
      process.env.JWT_ADMIN_SECRET,
      { expiresIn: "8h" }
    );

    return {
      statusCode: 302,
      headers: {
        Location: "/admin",
        "Set-Cookie": `ttao_admin=${token}; Path=/; Secure; SameSite=Lax; Max-Age=28800`,
      },
      body: "",
    };
  } catch (err) {
    console.error("Admin auth error:", err);
    return { statusCode: 302, headers: { Location: "/admin?error=exception" }, body: "" };
  }
};
