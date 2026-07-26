import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TOKENLESS_COMPONENT_ROOT = fileURLToPath(new URL("../", import.meta.url));

type RawControlAllowance = {
  count: number;
  reason: string;
};

// These files define a low-level accessible primitive or carry a hidden native-form
// value that cannot be represented by a visible Field. Entries are occurrence-counted:
// adding another raw control to even an allowed file fails this guard.
const RAW_CONTROL_ALLOWLIST: Record<string, Record<string, RawControlAllowance>> = {
  "agents/AgentOAuthConsentForm.tsx": {
    "input:hidden": { count: 2, reason: "Hidden values submit the server-rendered OAuth decision form." },
  },
  "agents/setup/AgentSetupFlow.tsx": {
    "input:hidden": { count: 2, reason: "Hidden values submit the server-rendered people decision form." },
  },
  "agents/setup/SetupChoiceGroup.tsx": {
    "input:radio": { count: 1, reason: "SetupRadioChoice is the accessible radio-card primitive." },
  },
  "forms/Field.tsx": {
    "input:dynamic": { count: 1, reason: "ChoiceInput is the shared checkbox and radio primitive." },
    "input:text": { count: 1, reason: "Field is the shared input primitive." },
    select: { count: 1, reason: "SelectField is the shared select primitive." },
    textarea: { count: 1, reason: "TextareaField is the shared textarea primitive." },
  },
  "navigation/SiteSearch.tsx": {
    "input:search": { count: 1, reason: "SiteSearch is the application combobox primitive." },
  },
  "review/CrowdForecastField.tsx": {
    "input:number": { count: 1, reason: "CrowdForecastField synchronizes one number control with its slider." },
    "input:range": { count: 1, reason: "CrowdForecastField owns the accessible range primitive." },
  },
  "ui/Chip.tsx": {
    "input:checkbox": { count: 1, reason: "Chip is the shared visually styled checkbox primitive." },
  },
};

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function productionComponentFiles(directory = TOKENLESS_COMPONENT_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return productionComponentFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".tsx") || /\.test\.tsx$/u.test(entry.name)) return [];
    return [path];
  });
}

function rawControlKey(control: string, tag: string) {
  if (tag !== "input") return tag;
  const staticType = /\btype\s*=\s*["']([^"']+)["']/u.exec(control)?.[1];
  if (staticType) return `input:${staticType}`;
  if (/\btype\s*=\s*\{/u.test(control)) return "input:dynamic";
  return "input:text";
}

test("every production tokenless form control uses a shared primitive", () => {
  const actual = new Map<string, Map<string, number>>();

  for (const file of productionComponentFiles()) {
    const path = relative(TOKENLESS_COMPONENT_ROOT, file).replaceAll("\\", "/");
    const controls = [...readFileSync(file, "utf8").matchAll(/<(input|select|textarea)\b[^>]*>/gu)];
    if (!controls.length) continue;

    const counts = new Map<string, number>();
    for (const control of controls) {
      const key = rawControlKey(control[0], control[1]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      assert.ok(
        RAW_CONTROL_ALLOWLIST[path]?.[key],
        `${path} has an unapproved raw ${key}; use Field, SelectField, TextareaField, or ChoiceInput`,
      );
    }
    actual.set(path, counts);
  }

  for (const [path, allowances] of Object.entries(RAW_CONTROL_ALLOWLIST)) {
    assert.ok(actual.has(path), `${path} is a stale raw-control allowance`);
    for (const [key, allowance] of Object.entries(allowances)) {
      assert.ok(allowance.reason.trim().length > 0, `${path} ${key} needs an allowlist reason`);
      assert.equal(actual.get(path)?.get(key) ?? 0, allowance.count, `${path} raw ${key} occurrence count changed`);
    }
  }
});

test("retrofitted handlers return the exact field that clients render", () => {
  const mappings = [
    ["../../../app/api/account/deletion/route.ts", "confirmation"],
    ["../../../app/api/account/reviewer-invitations/preview/route.ts", "token"],
    ["../../../app/api/account/reviewer-invitations/redeem/route.ts", "token"],
    ["../../../app/api/account/workspace-invitations/redeem/route.ts", "token"],
    ["../../../app/api/account/workspaces/route.ts", "name"],
    ["../../../app/api/notifications/email/route.ts", "email"],
    ["../../../lib/tokenless/accountProfile.ts", "displayName"],
  ] as const;

  for (const [file, field] of mappings) {
    assert.match(source(file), new RegExp(`["']${field}["']`, "u"), `${file} maps ${field}`);
  }
});
