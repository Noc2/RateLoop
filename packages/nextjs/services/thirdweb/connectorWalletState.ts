"use client";

import type { Wallet } from "thirdweb/wallets";

let connectedThirdwebConnectorWallet: Wallet | null = null;
const listeners = new Set<(wallet: Wallet | null) => void>();
let notificationScheduled = false;

function scheduleListenerNotification() {
  if (notificationScheduled) {
    return;
  }

  notificationScheduled = true;
  const notify = () => {
    notificationScheduled = false;
    const wallet = connectedThirdwebConnectorWallet;

    for (const listener of listeners) {
      listener(wallet);
    }
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(notify);
    return;
  }

  void Promise.resolve().then(notify);
}

export function getConnectedThirdwebConnectorWallet() {
  return connectedThirdwebConnectorWallet;
}

export function setConnectedThirdwebConnectorWallet(wallet: Wallet | null) {
  connectedThirdwebConnectorWallet = wallet;
  scheduleListenerNotification();
}

export function subscribeConnectedThirdwebConnectorWallet(listener: (wallet: Wallet | null) => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
