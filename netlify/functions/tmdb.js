// Netlify serverless function: proxies requests to TMDB so the API key
// never ships in client-side JS. Reads TMDB_API_KEY from environment
// variables (set in Netlify site settings, or a local .env for netlify dev).

exports.handler = async function (event) {
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "TMDB_API_KEY is not set in this site's environment variables." })
    };
  }

  const path = event.queryStringParameters && event.queryStringParameters.path;
  if (!path || !path.startsWith("/")) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing or invalid 'path' query parameter." })
    };
  }

  const params = new URLSearchParams(event.queryStringParameters);
  params.delete("path");
  params.set("api_key", apiKey);

  const url = `https://api.themoviedb.org/3${path}?${params.toString()}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Couldn't reach TMDB." })
    };
  }
};
