import type { Metadata } from "next";
import { Homemade_Apple, Cedarville_Cursive } from "next/font/google";
import "./globals.css";

// Handwritten display font for the digital answer-sheet (req 3).
const handwriting = Homemade_Apple({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-hand",
  display: "swap",
});

// Cursive font for the examiner's red notes written over the answers.
const noteFont = Cedarville_Cursive({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-note",
  display: "swap",
});

export const metadata: Metadata = {
  title: "UPSC Mains Essay Evaluator",
  description: "Transcribe handwritten answer PDFs into digital answer-sheets and get inline examiner feedback.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${handwriting.variable} ${noteFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
