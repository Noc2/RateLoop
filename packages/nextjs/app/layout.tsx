import { Inter, Space_Grotesk } from "next/font/google";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale } from "~~/i18n/config";
import { getMessagesForLocale } from "~~/i18n/messages";
import { THEME_COOKIE_NAME, createThemeBootstrapScript, parseThemePreference } from "~~/lib/ui/themePreference";
import { AppProviders } from "~~/providers/AppProviders";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

// Per-request CSP nonces can protect only dynamically rendered Next.js scripts.
// Keep this at the root so framework error and not-found pages receive a nonce too.
export const dynamic = "force-dynamic";

// The default-locale copy, so the root and the [locale] segment cannot drift apart.
export const metadata = getMetadata(getMessagesForLocale(DEFAULT_LOCALE).shell.siteMetadata);

const spaceGrotesk = Space_Grotesk({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-hawig-heading",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-hawig-body",
});

const RootLayout = async ({ children }: { children: React.ReactNode }) => {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const requestedLocale = requestHeaders.get("x-next-intl-locale");
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  const explicitTheme = parseThemePreference(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      className={`${spaceGrotesk.variable} ${inter.variable}`}
      data-theme={explicitTheme}
      suppressHydrationWarning
      style={explicitTheme ? { colorScheme: explicitTheme } : undefined}
    >
      <body suppressHydrationWarning>
        <script
          id="rateloop-theme-bootstrap"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: createThemeBootstrapScript() }}
        />
        <AppProviders notificationDismissLabel={getMessagesForLocale(locale).shared.notifications.dismiss}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
};

export default RootLayout;
