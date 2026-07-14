import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { constructStripeEvent, processStripeWebhook } from "~~/lib/billing/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = constructStripeEvent(rawBody, request.headers.get("stripe-signature"));
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      return NextResponse.json({ code: "invalid_signature", message: "Invalid Stripe signature." }, { status: 400 });
    }
    console.error("[stripe-webhook] signature verification failed", error);
    return NextResponse.json({ code: "webhook_unavailable", message: "Webhook verification failed." }, { status: 503 });
  }

  try {
    const result = await processStripeWebhook({ event, rawBody });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("[stripe-webhook] processing failed", {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { code: "webhook_processing_failed", message: "Webhook processing failed." },
      { status: 500 },
    );
  }
}
