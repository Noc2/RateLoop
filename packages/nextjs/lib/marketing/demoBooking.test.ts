import { resolveDemoBookingUrl } from "./demoBooking";
import assert from "node:assert/strict";
import test from "node:test";

test("the demo booking URL resolves only to a safe external HTTPS destination", () => {
  assert.equal(
    resolveDemoBookingUrl({
      TOKENLESS_DEMO_BOOKING_URL: "https://calendar.google.com/calendar/appointments/schedules/abc123?gv=true",
    }),
    "https://calendar.google.com/calendar/appointments/schedules/abc123?gv=true",
  );
  assert.equal(
    resolveDemoBookingUrl({ TOKENLESS_DEMO_BOOKING_URL: "  https://cal.example/demo  " }),
    "https://cal.example/demo",
  );

  // Unset falls back to the caller's mailto rather than rendering a dead control.
  assert.equal(resolveDemoBookingUrl({}), null);
  assert.equal(resolveDemoBookingUrl({ TOKENLESS_DEMO_BOOKING_URL: "   " }), null);

  // A prospect reaches this from a public page, so anything but plain HTTPS is refused.
  assert.equal(resolveDemoBookingUrl({ TOKENLESS_DEMO_BOOKING_URL: "http://cal.example/demo" }), null);
  assert.equal(resolveDemoBookingUrl({ TOKENLESS_DEMO_BOOKING_URL: "javascript:alert(1)" }), null);
  assert.equal(resolveDemoBookingUrl({ TOKENLESS_DEMO_BOOKING_URL: "not a url" }), null);
  assert.equal(resolveDemoBookingUrl({ TOKENLESS_DEMO_BOOKING_URL: "https://user:pass@cal.example/demo" }), null);
});
