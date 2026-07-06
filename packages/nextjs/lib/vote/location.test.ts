import {
  buildVoteContentPinKey,
  buildVoteContentPinKeyFromUrl,
  buildVoteLocation,
  readVoteLocationScope,
} from "./location";
import assert from "node:assert/strict";
import test from "node:test";

test("switching categories clears the requested content query params", () => {
  assert.equal(
    buildVoteLocation("https://www.rateloop.ai/rate?content=6&chainId=8453&deploymentKey=8453%3A0xabc&q=openlaw", {
      contentId: null,
      categoryHash: "youtube",
    }),
    "https://www.rateloop.ai/rate?q=openlaw#youtube",
  );
});

test("switching feed views clears requested content scope without changing the active route filters", () => {
  assert.equal(
    buildVoteLocation(
      "https://www.rateloop.ai/rate?content=82&chainId=8453&deploymentKey=8453%3A0xabc&q=ed-sheeran#youtube",
      {
        contentId: null,
      },
    ),
    "https://www.rateloop.ai/rate?q=ed-sheeran#youtube",
  );
});

test("selecting content preserves the active category hash", () => {
  assert.equal(
    buildVoteLocation("https://www.rateloop.ai/rate?q=openlaw#youtube", {
      contentId: 9n,
      chainId: 8453,
      deploymentKey: " 8453:0xabc ",
    }),
    "https://www.rateloop.ai/rate?q=openlaw&content=9&chainId=8453&deploymentKey=8453%3A0xabc#youtube",
  );
});

test("selecting unscoped content clears stale content scope", () => {
  assert.equal(
    buildVoteLocation("https://www.rateloop.ai/rate?content=6&chainId=8453&deploymentKey=8453%3A0xabc&q=openlaw", {
      contentId: 9n,
    }),
    "https://www.rateloop.ai/rate?content=9&q=openlaw",
  );
});

test("content location updates clear social rating version params", () => {
  assert.equal(
    buildVoteLocation("https://www.rateloop.ai/rate?content=6&chainId=8453&rv=r-6-5000-1-0&q=openlaw#youtube", {
      contentId: 9n,
      chainId: 8453,
    }),
    "https://www.rateloop.ai/rate?content=9&chainId=8453&q=openlaw#youtube",
  );
  assert.equal(
    buildVoteLocation("https://www.rateloop.ai/rate?content=6&chainId=8453&rv=r-6-5000-1-0&q=openlaw#youtube", {
      contentId: null,
    }),
    "https://www.rateloop.ai/rate?q=openlaw#youtube",
  );
});

test("persisting a selected card adds the content query param to a plain vote url", () => {
  assert.equal(
    buildVoteLocation("https://www.rateloop.ai/rate", {
      contentId: 12n,
    }),
    "https://www.rateloop.ai/rate?content=12",
  );
});

test("content pin keys normalize query order and ignore hash changes", () => {
  assert.equal(
    buildVoteContentPinKeyFromUrl("https://www.rateloop.ai/rate?q=openlaw&content=6#youtube"),
    "/rate?content=6&q=openlaw",
  );
  assert.equal(
    buildVoteContentPinKeyFromUrl("https://www.rateloop.ai/rate?content=6&q=openlaw#books"),
    "/rate?content=6&q=openlaw",
  );
});

test("content pin keys preserve social rating version params", () => {
  assert.equal(
    buildVoteContentPinKeyFromUrl("https://www.rateloop.ai/rate?rv=r-6-5000-1-0&q=openlaw&content=6#youtube"),
    "/rate?content=6&q=openlaw&rv=r-6-5000-1-0",
  );
});

test("content pin keys are absent without a content query param", () => {
  assert.equal(buildVoteContentPinKey("/rate", new URLSearchParams("q=openlaw")), null);
});

test("rate location scope reads valid chain and deployment params", () => {
  assert.deepEqual(readVoteLocationScope(new URLSearchParams("content=6&chainId=8453&deploymentKey=8453%3A0xabc")), {
    chainId: 8453,
    deploymentKey: "8453:0xabc",
  });
  assert.deepEqual(readVoteLocationScope(new URLSearchParams("chainId=8453.5&deploymentKey=%20")), null);
});
