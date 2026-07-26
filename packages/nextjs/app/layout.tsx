import { Inter, Space_Grotesk } from "next/font/google";
import { AppProviders } from "~~/providers/AppProviders";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "RateLoop — Human assurance for AI",
  description: "Get blind human feedback before you ship AI work.",
});

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

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html
    lang="en"
    className={`${spaceGrotesk.variable} ${inter.variable}`}
    data-theme="dark"
    suppressHydrationWarning
    style={{ colorScheme: "dark" }}
  >
    <body suppressHydrationWarning>
      <AppProviders>{children}</AppProviders>
    </body>
  </html>
);

export default RootLayout;
