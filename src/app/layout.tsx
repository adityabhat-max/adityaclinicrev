import type { Metadata } from "next";
import "./globals.css";
import { THEME_SCRIPT } from "@/components/ThemeToggle";

export const metadata: Metadata = { title: "Clinic Sales Dashboard", description: "Center-wise sales vs target, live from Zenoti" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the script below before React loads, hence suppressHydrationWarning
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
