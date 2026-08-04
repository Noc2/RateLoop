type AgentTranslate = (key: string, values?: Record<string, number | string>) => string;

const PERIOD_KEYS: Record<string, string> = {
  "Last 7 days": "last7Days",
  "Last 30 days": "last30Days",
  "Last 90 days": "last90Days",
  Lifetime: "periodLifetime",
  "Lifetime by scope": "lifetimeByScope",
  "Current evidence state": "currentEvidenceState",
};

const REASON_KEYS: Record<string, string> = {
  "No completed review cases in this window.": "noCompletedCases",
  "No case met its frozen panel privacy threshold in this window.": "noCasesAtPrivacyThreshold",
  "At least two privacy-eligible, multi-reviewer cases are required for reviewer consistency.":
    "reviewerConsistencyNeedsCases",
  "Reviewer consistency is undefined because every eligible response used the same choice.":
    "reviewerConsistencySingleChoice",
  "No completed review outcomes in this window.": "noCompletedOutcomes",
  "No decision timing is available in this window.": "noDecisionTiming",
  "No privacy-eligible decision timing is available in this window.": "noEligibleDecisionTiming",
  "No comparable decisions in this window.": "noComparableDecisions",
};

const PANEL_BUCKET_KEYS: Record<string, string> = {
  unanimous: "panelUnanimous",
  low: "panelDissentUnder25",
  moderate: "panelDissent25To50",
  high: "panelDissentOver50",
};

const DECISION_TIME_BUCKET_KEYS: Record<string, string> = {
  under_5m: "timeUnder5Minutes",
  "5m_to_15m": "time5To15Minutes",
  "15m_to_1h": "time15To60Minutes",
  "1h_to_4h": "time1To4Hours",
  over_4h: "timeOver4Hours",
};

export function localizeOverviewPeriod(label: string, t: AgentTranslate) {
  const key = PERIOD_KEYS[label];
  return key ? t(key) : label;
}

export function localizeOverviewReason(reason: string, t: AgentTranslate) {
  const key = REASON_KEYS[reason];
  return key ? t(key) : reason;
}

export function localizeQualityBucket(key: string, fallback: string, unit: "cases" | "decisions", t: AgentTranslate) {
  const messageKey = unit === "cases" ? PANEL_BUCKET_KEYS[key] : DECISION_TIME_BUCKET_KEYS[key];
  return messageKey ? t(messageKey) : fallback;
}
