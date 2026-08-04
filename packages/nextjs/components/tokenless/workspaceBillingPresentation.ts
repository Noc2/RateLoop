type SupportedLocale = "de" | "en";

const BILLING_STATUS = {
  active: { en: "Active", de: "Aktiv" },
  trialing: { en: "Trial", de: "Testphase" },
  past_due: { en: "Payment overdue", de: "Zahlung überfällig" },
  unpaid: { en: "Unpaid", de: "Unbezahlt" },
  canceled: { en: "Canceled", de: "Gekündigt" },
  incomplete: { en: "Setup incomplete", de: "Einrichtung unvollständig" },
  incomplete_expired: { en: "Setup expired", de: "Einrichtung abgelaufen" },
  paused: { en: "Paused", de: "Pausiert" },
  free: { en: "Free", de: "Kostenlos" },
} as const;

const TOPUP_STATUS = {
  draft: { en: "Draft", de: "Entwurf" },
  sent: { en: "Invoice sent", de: "Rechnung gesendet" },
  paid: { en: "Paid", de: "Bezahlt" },
  credited: { en: "Balance credited", de: "Guthaben verbucht" },
  failed: { en: "Failed", de: "Fehlgeschlagen" },
} as const;

const RESERVATION_STATUS = {
  reserved: { en: "Reserved funds", de: "Reserviertes Guthaben" },
  accepted: { en: "Accepted reservation", de: "Angenommene Reservierung" },
  released: { en: "Released reservation", de: "Freigegebene Reservierung" },
  settled: { en: "Settled reservation", de: "Abgerechnete Reservierung" },
  completed: { en: "Completed reservation", de: "Abgeschlossene Reservierung" },
  expired: { en: "Expired reservation", de: "Abgelaufene Reservierung" },
  cancelled: { en: "Cancelled reservation", de: "Abgebrochene Reservierung" },
  canceled: { en: "Canceled reservation", de: "Abgebrochene Reservierung" },
} as const;

const LEDGER_SOURCE = {
  invoice: { en: "Invoice credit", de: "Rechnungsgutschrift" },
  fiat_topup: { en: "Top-up credit", de: "Aufladungsgutschrift" },
  fiat_topup_reversal: { en: "Top-up reversal", de: "Storno der Aufladung" },
} as const;

function supportedLocale(locale: string): SupportedLocale {
  return locale === "de" ? "de" : "en";
}

function lookup<T extends Record<string, Record<SupportedLocale, string>>>(
  values: T,
  value: string,
  locale: string,
  fallback: Record<SupportedLocale, string>,
) {
  return (values[value as keyof T] ?? fallback)[supportedLocale(locale)];
}

export function billingStatusLabel(status: string, locale: string) {
  return lookup(BILLING_STATUS, status, locale, { en: "Status unavailable", de: "Status nicht verfügbar" });
}

export function topupStatusLabel(status: string, locale: string) {
  return lookup(TOPUP_STATUS, status, locale, { en: "Status unavailable", de: "Status nicht verfügbar" });
}

export function reservationStatusLabel(status: string, locale: string) {
  return lookup(RESERVATION_STATUS, status, locale, {
    en: "Reservation status unavailable",
    de: "Reservierungsstatus nicht verfügbar",
  });
}

export function ledgerSourceLabel(source: string, locale: string) {
  return lookup(LEDGER_SOURCE, source, locale, { en: "Balance adjustment", de: "Guthabenanpassung" });
}
