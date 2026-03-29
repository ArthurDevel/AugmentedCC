import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VR Desktop",
  description: "Quest 3 AR Desktop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
