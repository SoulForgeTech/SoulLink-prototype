import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import ReduxProvider from "@/components/providers/ReduxProvider";
import GlassRipple from "@/components/effects/GlassRipple";
import "./globals.css";

const poppins = Poppins({
  weight: ["400", "600"],
  subsets: ["latin"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SoulLink — Your AI Companion",
  description: "AI companion app with chat, voice, and image generation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={poppins.className}>
        <ReduxProvider>
          <GlassRipple />
          {children}
          <SpeedInsights />
        </ReduxProvider>
      </body>
    </html>
  );
}
