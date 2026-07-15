import { NextResponse } from "next/server";
import { getBetterAuthConfiguration } from "~~/lib/auth/betterAuth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = getBetterAuthConfiguration();
    return NextResponse.json(
      {
        configured: (process.env.BETTER_AUTH_SECRET?.trim().length ?? 0) >= 32,
        methods: {
          apple: config.appleEnabled,
          emailOtp: config.emailOtpEnabled,
          google: config.googleEnabled,
          passkey: true,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { configured: false, methods: { apple: false, emailOtp: false, google: false, passkey: false } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
