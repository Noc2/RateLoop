import { NextRequest, NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { readPublicQuestionImage } from "~~/lib/tokenless/publicQuestionMedia";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { assetId } = await context.params;
    const session = await findAuthSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
    const image = await readPublicQuestionImage({
      accountAddress: session?.principalId,
      assetId,
      previewCapability: request.nextUrl.searchParams.get("preview"),
      previewDigest: request.nextUrl.searchParams.get("digest"),
    });
    return new NextResponse(Buffer.from(image.bytes), {
      headers: {
        "Cache-Control": image.public ? "public, max-age=86400, stale-while-revalidate=604800" : "private, no-store",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": image.contentType,
        ETag: `"${image.digest.replace(/^sha256:/, "")}"`,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: { "Cache-Control": "private, no-store" },
      status: response.status,
    });
  }
}
