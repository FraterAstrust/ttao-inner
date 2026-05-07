exports.handler = async () => {
  const clientId = process.env.PATREON_CLIENT_ID;
  const redirectUri = process.env.PATREON_REDIRECT_URI;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "identity identity.memberships",
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://www.patreon.com/oauth2/authorize?${params}`,
    },
    body: "",
  };
};