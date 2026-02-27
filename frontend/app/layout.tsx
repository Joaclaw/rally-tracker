import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const font = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
});

export const metadata: Metadata = {
  title: "Rally Tracker | On-chain Campaign Analytics",
  description: "Track Rally.fun campaigns with on-chain revenue metrics, ghost wallets, and AI score analytics.",
  openGraph: {
    title: "Rally Tracker",
    description: "On-chain campaign analytics for Rally.fun",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${font.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
