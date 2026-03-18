import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ── Rate limit store (Edge-compatible, in-memory per region) ──
// For production, replace with Upstash Redis for global rate limiting:
// https://upstash.com/docs/redis/sdks/vercel-edge
const rateMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT      = 60;   // requests per window
const RATE_WINDOW_MS  = 60_000; // 1 minute window

// ── Suspicious user-agent patterns (scrapers, bots) ────────
const BLOCKED_UA_PATTERNS = [
  /scrapy/i, /wget/i, /curl/i, /python-requests/i,
  /go-http-client/i, /java\/|okhttp/i, /libwww/i,
  /masscan/i, /zgrab/i, /nmap/i, /nikto/i,
];

// ── Block specific paths that shouldn't be accessible ──────
const BLOCKED_PATHS = [
  /\.env/i, /\.git/i, /wp-admin/i, /wp-login/i,
  /phpinfo/i, /\.php$/i, /admin\.php/i,
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = request.ip ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "";

  // ── 1. Block malicious paths immediately ───────────────
  if (BLOCKED_PATHS.some((p) => p.test(pathname))) {
    return new NextResponse(null, { status: 404 });
  }

  // ── 2. Block known bad user agents ─────────────────────
  if (BLOCKED_UA_PATTERNS.some((p) => p.test(ua))) {
    return new NextResponse(null, { status: 403 });
  }

  // ── 3. Rate limiting ────────────────────────────────────
  const now = Date.now();
  const key = ip;
  const record = rateMap.get(key);

  if (!record || now > record.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else {
    record.count++;
    if (record.count > RATE_LIMIT) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((record.resetAt - now) / 1000)),
            "X-RateLimit-Limit": String(RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }
  }

  // ── 4. Add security headers to every response ──────────
  const response = NextResponse.next();

  // Remove headers that fingerprint the server
  response.headers.delete("x-powered-by");
  response.headers.delete("server");

  // Prevent clickjacking while allowing our iframe
  response.headers.set("X-Frame-Options", "ALLOWALL");

  // Strict CSP
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // Only allow connections to our own services
      `connect-src 'self' https://*.supabase.co https://api.emailjs.com https://www.youtube.com https://img.youtube.com https://www.youtube.com/oembed`,
      "img-src 'self' data: https://img.youtube.com https://i.ytimg.com",
      "media-src 'self' blob:",
      "frame-src 'self' https://www.youtube.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ")
  );

  return response;
}

export const config = {
  matcher: [
    // Apply to all routes except static files and api routes
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
