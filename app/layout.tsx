import type { Metadata } from "next";
import { Cedarville_Cursive, Playwrite_IN } from "next/font/google";
import "./globals.css";

// Handwritten display font for the transcribed answer-sheet (req 3).
const handwriting = Cedarville_Cursive({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-hand",
  display: "swap",
});

// Cursive font for the examiner's red evaluation marks over the answers (req 3).
// Playwrite IN ships no `subsets`/`preload` options.
const noteFont = Playwrite_IN({
  weight: "400",
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
