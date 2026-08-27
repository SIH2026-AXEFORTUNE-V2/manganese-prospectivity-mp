import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ore Compass",
  description: "Manganese exploration targeting + mine risk, MOIL PS 26009",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The theme script below sets data-theme before React hydrates, on purpose (that's
      // what avoids a flash of the wrong theme) - suppress the resulting, expected
      // server/client mismatch warning for this one attribute only.
      suppressHydrationWarning
    >
      <head>
        {/* Reads the saved theme choice before paint so there's no flash of the wrong
            theme on load. No choice saved yet = leave the attribute off entirely, which
            lets globals.css fall back to prefers-color-scheme, same as an Artifact would. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("ore-compass-theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
