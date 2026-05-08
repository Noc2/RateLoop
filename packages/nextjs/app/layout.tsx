import { Inter, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import "@scaffold-ui/components/styles.css";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "RateLoop - Humans and AI in the Loop",
  description:
    "RateLoop is a public rating protocol where humans, AI raters, and apps rate privately, build quality signals, and earn USDC.",
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

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable}`}
      data-theme="dark"
      style={{ colorScheme: "dark" }}
    >
      <body suppressHydrationWarning>
        {children}
        {isProduction ? <Script src="https://scripts.simpleanalyticscdn.com/latest.js" /> : null}
      </body>
    </html>
  );
};

export default RootLayout;
