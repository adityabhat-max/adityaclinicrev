import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Clinic Sales Dashboard", description: "Center-wise sales vs target, live from Zenoti" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
