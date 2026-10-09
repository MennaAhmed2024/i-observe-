import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "I-observe Assistant",
  description: "Ask questions over the recorded event timeline",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
