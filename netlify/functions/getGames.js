// Fonction Netlify : relais entre le site et l'API IGDB.
//
// Variables d'environnement à définir sur Netlify
// (Site configuration > Environment variables) :
//   TWITCH_CLIENT_ID      -> le Client ID de ton application sur dev.twitch.tv
//   TWITCH_CLIENT_SECRET  -> le Client Secret de la même application
//
// Plus besoin de TWITCH_ACCESS_TOKEN : le jeton est demandé à Twitch
// automatiquement et renouvelé tout seul quand il expire.

let cachedToken = null;
let tokenExpiresAt = 0;

const ALLOWED_ENDPOINTS = new Set(["games", "platforms"]);

async function getToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TWITCH_CLIENT_ID ou TWITCH_CLIENT_SECRET manque dans les variables d'environnement Netlify.");
  }

  const url = "https://id.twitch.tv/oauth2/token"
    + `?client_id=${encodeURIComponent(clientId)}`
    + `&client_secret=${encodeURIComponent(clientSecret)}`
    + "&grant_type=client_credentials";

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Twitch a refusé le Client ID ou le Client Secret (code ${res.status}). Vérifie tes variables Netlify.`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // On le considère périmé une heure avant sa vraie expiration, par sécurité.
  tokenExpiresAt = Date.now() + Math.max(0, data.expires_in - 3600) * 1000;
  return cachedToken;
}

function callIgdb(endpoint, query, token) {
  return fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "text/plain"
    },
    body: query
  });
}

// Autorise le site hébergé sur GitHub Pages (ou ailleurs) à appeler cette fonction.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Méthode non autorisée" });
  }

  const endpoint = (event.queryStringParameters && event.queryStringParameters.endpoint) || "games";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return json(400, { error: `Endpoint non autorisé : ${endpoint}` });
  }

  const query = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");

  try {
    let token = await getToken();
    let res = await callIgdb(endpoint, query, token);

    // Jeton refusé (expiré ou révoqué) : on en redemande un et on réessaie une fois.
    if (res.status === 401) {
      token = await getToken(true);
      res = await callIgdb(endpoint, query, token);
    }

    const text = await res.text();
    if (!res.ok) {
      return json(res.status, { error: `IGDB a répondu avec le code ${res.status}.`, details: text });
    }
    return json(200, text);
  } catch (error) {
    return json(500, { error: error.message });
  }
};
