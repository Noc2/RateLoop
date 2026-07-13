import { Inter, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { BaseAccountProviders } from "~~/providers/BaseAccountProviders";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "RateLoop — Human assurance for AI workflows",
  description:
    "Test AI-enabled work with blinded human panels, written reasons, and verifiable settlement evidence before rollout.",
});

const isProduction = process.env.NODE_ENV === "production";

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
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable}`}
      data-theme="dark"
      suppressHydrationWarning
      style={{ colorScheme: "dark" }}
    >
      <body suppressHydrationWarning>
        <BaseAccountProviders>{children}</BaseAccountProviders>
        {isProduction ? <Script nonce={nonce} src="https://scripts.simpleanalyticscdn.com/latest.js" /> : null}
      </body>
    </html>
  );
};

export default RootLayout;
