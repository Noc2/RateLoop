import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const signIn = readFileSync(new URL("./BetterAuthSignIn.tsx", import.meta.url), "utf8");
const signInPage = readFileSync(new URL("../../app/(public)/sign-in/page.tsx", import.meta.url), "utf8");
const signInSurface = readFileSync(new URL("./SignInSurface.tsx", import.meta.url), "utf8");
const wallets = readFileSync(new URL("./WalletBindingsClient.tsx", import.meta.url), "utf8");
const walletSettings = readFileSync(new URL("../../app/(app)/settings/wallets/page.tsx", import.meta.url), "utf8");
const privacy = readFileSync(new URL("../../app/(public)/legal/privacy/page.tsx", import.meta.url), "utf8");

test("account sign-in is Better Auth first and explicitly creates no wallet", () => {
  assert.match(signIn, /betterAuthClient\.emailOtp\.sendVerificationOtp/);
  assert.match(signIn, /betterAuthClient\.signIn\.passkey/);
  assert.match(signIn, /exchangeBetterAuthSession/);
  assert.doesNotMatch(signIn, /Creating a RateLoop account does not create a wallet/i);
  assert.doesNotMatch(signIn, /ConnectButton|inAppWallet/);
  assert.match(signIn, /function GoogleIcon/);
  assert.match(signIn, /function AppleIcon/);
  assert.match(signIn, /<GoogleIcon\s*\/>\s*Google/);
  assert.match(signIn, /<AppleIcon\s*\/>\s*Apple/);
  assert.match(signInPage, /<SignInSurface/);
  assert.match(signInPage, /branded title="Sign in"/);
  assert.doesNotMatch(signInPage, /No wallet required/i);
  assert.match(signInSurface, /The Human Assurance/);
  assert.match(signInSurface, /rateloop-text-gradient/);
  assert.match(signInSurface, /<RateLoopLogo/);
  assert.match(signInSurface, /<Card as="section"/);
  assert.match(signInSurface, /w-full max-w-md rounded-2xl p-8 text-center/);
});

test("wallet setup is explicit, purpose-bound, and supports thirdweb plus self-custody", () => {
  assert.match(wallets, /funding.*payout.*recovery/s);
  assert.match(wallets, /Create wallet with thirdweb/);
  assert.match(wallets, /Connect existing wallet/);
  assert.match(wallets, /signMessage/);
  assert.match(wallets, /never grants access to your RateLoop account/);
  assert.match(walletSettings, /findAuthSession/);
  assert.match(walletSettings, /redirect\("\/sign-in\?returnTo=%2Fsettings%2Fwallets"\)/);
});

test("privacy copy separates account identity, thirdweb processing, and public-chain linkability", () => {
  assert.match(privacy, /self-hosted Better Auth service/);
  assert.match(privacy, /do not create or require a wallet/);
  assert.match(privacy, /five-minute, audience-bound JWT/);
  assert.match(privacy, /Reusing a funding or payout address can link paid\s+activity/);
});
