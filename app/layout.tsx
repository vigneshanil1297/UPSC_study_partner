import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UPSC Mains Essay Evaluator",
  description: "Parse handwritten essay answers and get critical, criterion-wise feedback.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
