// CORS helpers for the extension public API.
//
// These endpoints live under `/api/public/*`, so Lovable's platform auth
// does not gate them — every handler MUST validate the extension token
// itself. The extension calls the API from two contexts:
//
// 1. Content script injected into `https://web.whatsapp.com` (that's the
//    Origin header on the request).
// 2. Extension popup / background service worker (Origin: `chrome-extension://<id>`
//    — the id changes per install, so we can't allowlist it).
//
// For the MVP we allow requests from the WhatsApp Web origin (where the
// injected panel lives) and from any chrome-extension origin. The security
// boundary is the token in the Authorization header, not the Origin.

const ALLOWED_ORIGINS = new Set(["https://web.whatsapp.com"]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return false;
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowOrigin = isAllowedOrigin(origin) ? origin! : "https://web.whatsapp.com";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonResponse(
  request: Request,
  body: unknown,
  init: { status?: number } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}
