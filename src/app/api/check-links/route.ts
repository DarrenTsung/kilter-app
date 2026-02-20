import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/check-links
 * Body: { urls: string[] }
 * Returns: { valid: string[] } — only URLs that are still publicly accessible
 *
 * Used to filter out deleted/private Instagram posts from beta video lists.
 */
export async function POST(request: NextRequest) {
  const { urls } = (await request.json()) as { urls: string[] };
  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ valid: [] });
  }

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      try {
        // Instagram always returns 200, but the embed HTML contains a
        // specific message when the post is deleted/private.
        const embedUrl = toEmbedUrl(url);
        const res = await fetch(embedUrl, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const html = await res.text();
        const isBroken =
          html.includes("may be broken") ||
          html.includes("may have been removed") ||
          html.includes("this page isn") ||
          html.includes("/accounts/login");
        return isBroken ? null : url;
      } catch {
        return null;
      }
    })
  );

  const valid = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((u): u is string => u !== null);

  return NextResponse.json({ valid });
}

/** Convert a URL to its embed form for validation */
function toEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("instagram.com")) {
      const path = u.pathname.replace(/\/$/, "");
      return `https://www.instagram.com${path}/embed/`;
    }
    return url;
  } catch {
    return url;
  }
}
