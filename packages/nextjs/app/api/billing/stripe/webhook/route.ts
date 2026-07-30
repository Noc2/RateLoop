import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { constructStripeEvent, processStripeWebhook } from "~~/lib/billing/webhooks";
import { BoundedRequestBodyError, readBoundedRequestText } from "~~/lib/tokenless/boundedRequestBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const STRIPE_WEBHOOK_BODY_MAX_BYTES = 1_024 * 1_024;

export async function readStripeWebhookBody(request: Pick<Request, "body" | "headers">) {
  try {
    return await readBoundedRequestText(request, STRIPE_WEBHOOK_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      if (error.reason === "body_too_large") {
        return { error: "Webhook payload is too large.", status: 413 } as const;
      }
      return { error: "Webhook payload is invalid.", status: 400 } as const;
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const body = await readStripeWebhookBody(request);
  if (typeof body !== "string") {
    return NextResponse.json(
      { code: body.status === 413 ? "webhook_too_large" : "invalid_payload", message: body.error },
      { status: body.status },
    );
  }
  const rawBody = body;
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
    if ("attention" in result && result.attention) {
      // Retrying will not resolve these, so the event is answered with a 200 and reported here as
      // well as being left un-processed in tokenless_billing_webhook_events for an operator.
      console.error("[stripe-webhook] event needs operator attention", {
        attention: result.attention,
        eventId: event.id,
        eventType: event.type,
      });
    }
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
