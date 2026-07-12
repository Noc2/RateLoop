import { NextRequest } from "next/server";
import { GET } from "./route";
import assert from "node:assert/strict";
import { test } from "node:test";

test("favicon ico redirects to the existing png icon", () => {
  const response = GET(new NextRequest("https://tokenless-preview.vercel.app/favicon.ico"));

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://tokenless-preview.vercel.app/favicon.png");
});
