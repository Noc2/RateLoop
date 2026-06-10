import { type TermsAcceptanceResolver, settlePendingTermsResolvers } from "./TermsAcceptanceContext";
import assert from "node:assert/strict";
import test from "node:test";

test("settlePendingTermsResolvers settles every concurrent caller with the modal outcome", async () => {
  const queue: TermsAcceptanceResolver[] = [];
  const first = new Promise<boolean>(resolve => queue.push(resolve));
  const second = new Promise<boolean>(resolve => queue.push(resolve));

  settlePendingTermsResolvers(queue, true);

  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(queue.length, 0);
});

test("settlePendingTermsResolvers resolves all pending callers with false when the modal is dismissed", async () => {
  const queue: TermsAcceptanceResolver[] = [];
  const first = new Promise<boolean>(resolve => queue.push(resolve));
  const second = new Promise<boolean>(resolve => queue.push(resolve));

  settlePendingTermsResolvers(queue, false);

  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(queue.length, 0);
});

test("settlePendingTermsResolvers is a no-op on an empty queue", () => {
  const queue: TermsAcceptanceResolver[] = [];
  settlePendingTermsResolvers(queue, true);
  assert.equal(queue.length, 0);
});

test("resolvers queued after a settle only settle on the next flush", async () => {
  const queue: TermsAcceptanceResolver[] = [];
  const first = new Promise<boolean>(resolve => queue.push(resolve));
  settlePendingTermsResolvers(queue, false);
  assert.equal(await first, false);

  let settled = false;
  const second = new Promise<boolean>(resolve => queue.push(resolve)).then(value => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  settlePendingTermsResolvers(queue, true);
  assert.equal(await second, true);
});
