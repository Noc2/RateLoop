import { appendGatedContextAddress, appendOptionalGatedContextAddress } from "./gatedContextFetchUrls";
import assert from "node:assert/strict";
import test from "node:test";

const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";
const imagePath =
  "/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const detailsPath = "/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh";

test("appendGatedContextAddress appends viewer address to hosted attachment paths", () => {
  assert.equal(
    appendGatedContextAddress(imagePath, walletAddress),
    "/api/attachments/images/att_abcdefghijklmnop.webp?address=0x1234567890abcdef1234567890abcdef12345678#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(
    appendGatedContextAddress(detailsPath, walletAddress),
    "/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh?address=0x1234567890abcdef1234567890abcdef12345678",
  );
});

test("appendGatedContextAddress rewrites production attachment URLs to same-origin paths", () => {
  assert.equal(
    appendGatedContextAddress(`https://rateloop.ai${imagePath}`, walletAddress, "https://www.rateloop.ai"),
    "/api/attachments/images/att_abcdefghijklmnop.webp?address=0x1234567890abcdef1234567890abcdef12345678#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(
    appendGatedContextAddress(`https://www.rateloop.ai${detailsPath}`, walletAddress, "https://rateloop.ai"),
    "/api/attachments/details/det_5AGUshsagKf6qq6hUWV-s3Bh?address=0x1234567890abcdef1234567890abcdef12345678",
  );
});

test("appendGatedContextAddress leaves external URLs and invalid wallets unchanged", () => {
  const external = `https://evil.example${imagePath}`;
  assert.equal(appendGatedContextAddress(external, walletAddress, "https://www.rateloop.ai"), external);
  assert.equal(appendGatedContextAddress(imagePath, "0xnope"), imagePath);
  assert.equal(appendOptionalGatedContextAddress(null, walletAddress), null);
});
