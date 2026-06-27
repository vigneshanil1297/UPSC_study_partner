import type { Metadata } from "next";
import { La_Belle_Aurore, Gloria_Hallelujah, Square_Peg } from "next/font/google";
import "./globals.css";

// Handwritten display font for the transcribed answer-sheet (req 3).
const handwriting = La_Belle_Aurore({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-hand",
  display: "swap",
});

// Block-print hand used only for abbreviations / multi-capital clusters
// (e.g. "PM-AWAS", "UPSC"), which read badly in joined cursive.
const capsFont = Gloria_Hallelujah({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-caps",
  display: "swap",
});

// Cursive font for the examiner's red evaluation marks over the answers (req 3).
const noteFont = Square_Peg({
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
    <html lang="en" className={`${handwriting.variable} ${capsFont.variable} ${noteFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
