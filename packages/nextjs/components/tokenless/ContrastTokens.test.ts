import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type Rgb = [number, number, number];

const stylesPromise = readFile(new URL("../../styles/globals.css", import.meta.url), "utf8");
const rootLayoutPromise = readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8");
const landingPagePromise = readFile(new URL("../../app/[locale]/(public)/page.tsx", import.meta.url), "utf8");
const assuranceLoopPromise = readFile(
  new URL("../../components/assurance/HumanAssuranceLoop.tsx", import.meta.url),
  "utf8",
);
const chipPromise = readFile(new URL("./ui/Chip.tsx", import.meta.url), "utf8");
const paidEligibilityPromise = readFile(new URL("./PaidEligibilityClient.tsx", import.meta.url), "utf8");
const publicQuestionCardPromise = readFile(new URL("./answer/PublicQuestionCard.tsx", import.meta.url), "utf8");
const fiftyPercentTextConsumerPromises = [
  readFile(new URL("../../components/pricing/WorkspacePlanCards.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/auth/WalletBindingsClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../app/[locale]/(public)/legal/page.tsx", import.meta.url), "utf8"),
];

function themeTokens(styles: string, theme: "light" | "dark") {
  const match = styles.match(new RegExp(`@plugin "daisyui/theme"\\s*\\{\\s*name: "${theme}";([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${theme} theme block is present`);
  return new Map(
    [...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(tokenMatch => [tokenMatch[1], tokenMatch[2].trim()]),
  );
}

function parseHex(value: string): Rgb {
  assert.match(value, /^#[\da-f]{6}$/i, `expected six-digit hex color, received ${value}`);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function parseForeground(value: string, background: Rgb): Rgb {
  if (value.startsWith("#")) return parseHex(value);
  const match = value.match(/^rgb\((\d+) (\d+) (\d+) \/ (0?\.\d+|1)\)$/);
  assert.ok(match, `expected rgb color with alpha, received ${value}`);
  const alpha = Number(match[4]);
  return [1, 2, 3].map(index => Math.round(Number(match[index]) * alpha + background[index - 1] * (1 - alpha))) as Rgb;
}

function relativeLuminance(color: Rgb) {
  const channels = color.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: Rgb, second: Rgb) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function assertContrast(foreground: string, background: string, label: string) {
  const parsedBackground = parseHex(background);
  const ratio = contrastRatio(parseForeground(foreground, parsedBackground), parsedBackground);
  assert.ok(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)}:1 is below WCAG AA`);
}

test("system color preference is the default and explicit choices are limited to light and dark", async () => {
  const [styles, rootLayout] = await Promise.all([stylesPromise, rootLayoutPromise]);
  assert.match(styles, /themes:\s*light --default,\s*dark;/);
  assert.doesNotMatch(styles, /name:\s*"system"/);
  assert.match(rootLayout, /parseThemePreference\(cookieStore\.get\(THEME_COOKIE_NAME\)\?\.value\)/);
  assert.match(rootLayout, /data-theme=\{explicitTheme\}/);
  assert.match(rootLayout, /id="rateloop-theme-bootstrap"/);
  assert.match(rootLayout, /nonce=\{nonce\}/);
  assert.match(rootLayout, /suppressHydrationWarning/);
  assert.match(rootLayout, /dangerouslySetInnerHTML=\{\{ __html: createThemeBootstrapScript\(\) \}\}/);
  assert.doesNotMatch(rootLayout, /from ["']next\/script["']/u);
  assert.doesNotMatch(rootLayout, /data-theme="(?:light|dark)"/);
});

test("light and dark themes expose the same complete semantic contract", async () => {
  const styles = await stylesPromise;
  const light = themeTokens(styles, "light");
  const dark = themeTokens(styles, "dark");
  const requiredDaisyTokens = [
    "--color-primary",
    "--color-primary-content",
    "--color-secondary",
    "--color-secondary-content",
    "--color-accent",
    "--color-accent-content",
    "--color-neutral",
    "--color-neutral-content",
    "--color-base-100",
    "--color-base-200",
    "--color-base-300",
    "--color-base-content",
    "--color-info",
    "--color-info-content",
    "--color-success",
    "--color-success-content",
    "--color-warning",
    "--color-warning-content",
    "--color-error",
    "--color-error-content",
    "--radius-selector",
    "--radius-field",
    "--radius-box",
    "--size-selector",
    "--size-field",
    "--border",
    "--depth",
    "--noise",
  ];
  const lightRateLoopTokens = [...light.keys()].filter(key => key.startsWith("--rateloop-")).sort();
  const darkRateLoopTokens = [...dark.keys()].filter(key => key.startsWith("--rateloop-")).sort();

  for (const token of requiredDaisyTokens) {
    assert.ok(light.has(token), `light theme defines ${token}`);
    assert.ok(dark.has(token), `dark theme defines ${token}`);
  }
  assert.deepEqual(lightRateLoopTokens, darkRateLoopTokens);
  assert.ok(lightRateLoopTokens.length >= 25, "semantic RateLoop token set covers shared surfaces and controls");
});

test("shared cards remain distinct from the page canvas in both themes", async () => {
  const styles = await stylesPromise;

  for (const theme of ["light", "dark"] as const) {
    const tokens = themeTokens(styles, theme);
    assert.notEqual(
      tokens.get("--rateloop-surface-elevated"),
      tokens.get("--color-base-100"),
      `${theme} cards must not disappear into the page canvas`,
    );
  }
});

test("inactive tabs remain distinct from the page canvas in both themes", async () => {
  const styles = await stylesPromise;

  for (const theme of ["light", "dark"] as const) {
    const tokens = themeTokens(styles, theme);
    assert.notEqual(
      tokens.get("--rateloop-tab-idle"),
      tokens.get("--color-base-100"),
      `${theme} inactive tabs must not disappear into the page canvas`,
    );
  }
});

test("semantic text and status pairs meet WCAG AA contrast in both themes", async () => {
  const styles = await stylesPromise;

  for (const theme of ["light", "dark"] as const) {
    const tokens = themeTokens(styles, theme);
    const value = (token: string) => {
      const result = tokens.get(token);
      assert.ok(result, `${theme} theme defines ${token}`);
      return result;
    };

    for (const surfaceToken of ["--rateloop-surface", "--rateloop-surface-elevated"] as const) {
      assertContrast(
        value("--rateloop-text-secondary"),
        value(surfaceToken),
        `${theme} secondary text on ${surfaceToken}`,
      );
      assertContrast(
        value("--rateloop-text-tertiary"),
        value(surfaceToken),
        `${theme} tertiary text on ${surfaceToken}`,
      );
    }

    assertContrast(value("--color-base-content"), value("--color-base-100"), `${theme} base text`);
    for (const accent of ["blue", "green", "yellow", "pink"]) {
      assertContrast(value(`--rateloop-${accent}`), value("--rateloop-surface"), `${theme} ${accent} brand text`);
      assertContrast(
        value(`--rateloop-${accent}`),
        value("--rateloop-surface-elevated"),
        `${theme} ${accent} brand text on elevated surface`,
      );
    }
    assertContrast(
      value("--rateloop-active-control-text"),
      value("--rateloop-active-control-bg"),
      `${theme} active control`,
    );
    for (const accent of ["green", "pink"] as const) {
      assertContrast(
        value("--rateloop-active-control-text"),
        value(`--rateloop-${accent}`),
        `${theme} active control text on ${accent}`,
      );
    }
    assertContrast(value("--rateloop-prose-link"), value("--rateloop-surface"), `${theme} prose link`);

    for (const role of ["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"]) {
      assertContrast(value(`--color-${role}-content`), value(`--color-${role}`), `${theme} ${role}`);
    }
  }
});

test("the desktop rail preserves the established dark surface in both page themes", async () => {
  const styles = await stylesPromise;
  assert.match(styles, /--rateloop-rail-surface: #050505/);
  assert.match(styles, /--rateloop-rail-text: #f5f5f5/);
  assert.match(styles, /\[data-rateloop-rail\][\s\S]*background: var\(--rateloop-rail-surface\)/);
  assertContrast("#f5f5f5", "#050505", "desktop rail");
});

test("shared surfaces and prose use semantic colors instead of dark-only literals", async () => {
  const styles = await stylesPromise;
  assert.match(styles, /html\s*\{\s*background: var\(--rateloop-surface\)/);
  assert.match(styles, /body\s*\{[\s\S]*?background: var\(--rateloop-surface\)/);
  assert.match(styles, /\.prose\s*\{\s*color: var\(--rateloop-text-secondary\)/);
  assert.match(styles, /\.prose pre\s*\{[\s\S]*?background: var\(--rateloop-code-surface\)/);
  assert.match(
    styles,
    /\.text-base-content\\\/55,\s*\.text-base-content\\\/50,\s*\.text-base-content\\\/45\s*\{\s*color: var\(--rateloop-text-secondary\)/,
  );
  for (const tier of ["40", "35", "30", "25"]) {
    assert.match(styles, new RegExp(`\\.text-base-content\\\\/${tier}`));
  }
});

test("legacy 50% text consumers share the AA secondary text token", async () => {
  const [styles, ...consumers] = await Promise.all([stylesPromise, ...fiftyPercentTextConsumerPromises]);

  assert.match(styles, /\.text-base-content\\\/50[\s\S]*?color: var\(--rateloop-text-secondary\)/);
  for (const consumer of consumers) assert.match(consumer, /text-base-content\/50/);
});

test("brand text consumers use theme-aware accent tokens", async () => {
  const [landingPage, assuranceLoop, chip, paidEligibility, publicQuestionCard] = await Promise.all([
    landingPagePromise,
    assuranceLoopPromise,
    chipPromise,
    paidEligibilityPromise,
    publicQuestionCardPromise,
  ]);

  for (const accent of ["blue", "green", "pink"]) {
    assert.match(landingPage, new RegExp(`color: "var\\(--rateloop-${accent}\\)"`));
  }
  for (const accent of ["blue", "green", "yellow", "pink"]) {
    assert.match(assuranceLoop, new RegExp(`color: "var\\(--rateloop-${accent}\\)"`));
  }
  assert.match(chip, /text-\[var\(--rateloop-pink\)\]/);
  assert.doesNotMatch(chip, /text-pink-100/);
  assert.match(paidEligibility, /text-\[var\(--rateloop-blue\)\]/);
  assert.doesNotMatch(paidEligibility, /text-sky-200/);
  assert.match(publicQuestionCard, /bg-\[var\(--rateloop-green\)\] text-\[var\(--rateloop-active-control-text\)\]/);
  assert.match(publicQuestionCard, /bg-\[var\(--rateloop-pink\)\] text-\[var\(--rateloop-active-control-text\)\]/);
});
