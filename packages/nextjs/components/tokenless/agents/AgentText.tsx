"use client";

import React, { Fragment } from "react";
import { useAgentTranslations } from "./AgentsLocaleProvider";

export function AgentText({ id, values }: { id: string; values?: Record<string, number | string> }) {
  const t = useAgentTranslations("ui");
  return <Fragment>{t(id, values)}</Fragment>;
}
