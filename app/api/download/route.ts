/**
 * GET /api/download?url=<encoded-url>&filename=<name>
 *
 * Server-side proxy that fetches the asset and returns it with
 * Content-Disposition: attachment so the browser saves it to disk.
 * Only allowed origins are proxied.
 */
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { join, normalize } from "path";
import { Readable } from "stream";
import { MEDIA_DIR } from "@/lib/guest/paths";

const ALLOWED_ORIGINS = [
  "https://cdn.kie.ai",
  "https://api.kie.ai",
  // kie.ai serves generated video/image results from these CDN hosts. Results
  // are normally mirrored to local disk first, but the mirror can fall back to
  // the source URL (lib/kieJobPoller.ts), so they must be proxyable too.
  "https://tempfile.aiquickdraw.com",
  "https://file.aiquickdraw.com",
  "https://replicate.delivery",
  "https://pbxt.replicate.delivery",
].map((o) => o.replace(/\/$/, ""));

function isAllowed(url: string): boolean {
  if (url.startsWith("/generated/")) return true; // local disk, served same-origin
  return ALLOWED_ORIGINS.some((origin) => url.startsWith(origin));
}

// Node (not edge): local `/generated/...` assets are streamed straight off
// disk, which needs `fs`.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") ?? "download";

  if (!url) return new NextResponse("Missing url", { status: 400 });
  if (!isAllowed(url)) return new NextResponse("Forbidden", { status: 403 });

  if (url.startsWith("/generated/")) {
    // Re-check after normalization: rejects "/generated/../api/..." traversal.
    const resolved = new URL(url, req.nextUrl.origin);
    if (!resolved.pathname.startsWith("/generated/")) return new NextResponse("Forbidden", { status: 403 });

    // Serve from MEDIA_DIR directly. Self-fetching over the loopback origin
    // works in dev but is fragile in the packaged sidecar for large files.
    const rel = normalize(decodeURIComponent(resolved.pathname.slice("/generated/".length)));
    if (rel.startsWith("..") || rel.includes("\0")) return new NextResponse("Forbidden", { status: 403 });

    const filePath = join(MEDIA_DIR, rel);
    if (!filePath.startsWith(normalize(MEDIA_DIR)) || !existsSync(filePath)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const { size } = statSync(filePath);
    const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch {
    return new NextResponse("Fetch failed", { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse("Upstream error", { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
