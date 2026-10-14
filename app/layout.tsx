import type { Metadata, Viewport } from "next";
import {
  Atkinson_Hyperlegible,
  JetBrains_Mono,
  Lexend,
  Source_Serif_4,
} from "next/font/google";
import { SETTINGS_STORAGE_KEY, THEMES } from "@/lib/settings";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
  display: "swap",
});

const lexend = Lexend({
  subsets: ["latin"],
  variable: "--font-lexend",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReadAloud – reading assistant",
  description:
    "ReadAloud is an accessible reading assistant that reads text aloud and highlights it as it goes.",
};

// Intentionally no maximumScale / userScalable restrictions so users can zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Apply the saved theme before first paint so there is no flash of the light
 * theme. ReaderApp keeps data-theme in sync afterwards.
 */
const THEME_SCRIPT = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  SETTINGS_STORAGE_KEY,
)})||"{}");var t=s&&s.theme;if(${JSON.stringify(THEMES)}.indexOf(t)>-1)document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${atkinson.variable} ${lexend.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
