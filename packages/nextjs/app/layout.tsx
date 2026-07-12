import { headers } from "next/headers";
import Script from "next/script";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "RateLoop Tokenless — paid human panels",
  description: "Run sealed paid human panels with itemized USDC funding and transparent settlement states.",
});

const isProduction = process.env.NODE_ENV === "production";

const RootLayout = async ({ children }: { children: React.ReactNode }) => {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning style={{ colorScheme: "dark" }}>
      <body suppressHydrationWarning>
        {children}
        {isProduction ? <Script nonce={nonce} src="https://scripts.simpleanalyticscdn.com/latest.js" /> : null}
      </body>
    </html>
  );
};

export default RootLayout;
