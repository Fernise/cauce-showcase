import type { Metadata, Viewport } from "next";
import { Archivo, Newsreader } from "next/font/google";
import "./globals.css";

// Archivo (Omnibus-Type): grotesque with a width axis — normal for reading, condensed for signage.
const archivo = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
// Newsreader (Production Type): serif reserved for people's words — messages, notes, quotes.
const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"], axes: ["opsz"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Cauce", template: "%s · Cauce" },
  description: "Coordinación de operaciones para empresas de limpieza",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#191816",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${archivo.variable} ${newsreader.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
