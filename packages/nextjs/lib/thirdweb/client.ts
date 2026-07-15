"use client";

import { createThirdwebClient } from "thirdweb";
import { createWallet, inAppWallet } from "thirdweb/wallets";

const clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID?.trim();

export const thirdwebBrowserClient = clientId ? createThirdwebClient({ clientId }) : null;
export const rateLoopThirdwebManagedWallet = inAppWallet({
  metadata: { name: "RateLoop payment wallet", icon: "/rateloop-logo.svg" },
});
export const rateLoopThirdwebWallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("org.base.account"),
];
