import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buffering Cat · WebHID LED Controller",
  description: "Control eight CH32V003 LEDs, animations, and firmware updates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
