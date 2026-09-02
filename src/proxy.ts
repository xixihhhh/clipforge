import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Local-tool CORS for /api/*.
 *
 * Browser pages served from OTHER local ports call our API cross-origin — the
 * first consumer is the infinite-canvas workbench running the ClipForge video
 * node plugin (canvas at :3800/:3000 → ClipForge at :3457). Without these
 * headers every such fetch dies at the browser wall.
 *
 * Security: only localhost/127.0.0.1/[::1] origins (any port) are reflected.
 * A remote malicious page's origin never matches, so the browser-side wall
 * against drive-by abuse of the local instance (which can trigger paid-model
 * spending) stays intact. Additional trusted origins can be granted explicitly
 * via CLIPFORGE_CORS_ORIGINS (comma-separated full origins).
 */

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (LOCAL_ORIGIN.test(origin)) return origin;
  const extra = (process.env.CLIPFORGE_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(origin) ? origin : null;
}

function corsHeaders(origin: string, req: NextRequest): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    // echo whatever headers the preflight asks for (Content-Type today; future-proof)
    "Access-Control-Allow-Headers": req.headers.get("access-control-request-headers") || "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function proxy(req: NextRequest): NextResponse;
export function proxy(req: NextRequest): NextResponse | Promise<NextResponse> {
  const origin = allowedOrigin(req.headers.get("origin"));
  // answer preflights here — API routes have no OPTIONS handlers
  if (req.method === "OPTIONS" && origin) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin, req) });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    return updateSaasSession(req, origin, supabaseUrl, supabaseAnonKey);
  }

  return addCorsHeaders(NextResponse.next({ request: req }), origin, req);
}

async function updateSaasSession(
  req: NextRequest,
  origin: string | null,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<NextResponse> {
    let res = NextResponse.next({ request: req });
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => res.headers.set(key, value));
        },
      },
    });

    const { data } = await supabase.auth.getClaims();
    const isAuthenticated = Boolean(data?.claims?.sub);
    const path = req.nextUrl.pathname;
    const isProtectedPage = path === "/dashboard" || path.startsWith("/dashboard/");
    const isPublicAuthPage = ["/login", "/register", "/forgot-password"].includes(path);

    if (isProtectedPage && !isAuthenticated) {
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("next", `${path}${req.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }
    if (isPublicAuthPage && isAuthenticated) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return addCorsHeaders(res, origin, req);
}

function addCorsHeaders(res: NextResponse, origin: string | null, req: NextRequest): NextResponse {
  if (origin) for (const [key, value] of Object.entries(corsHeaders(origin, req))) res.headers.set(key, value);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
