import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/features/auth/AuthProvider";

export const metadata: Metadata = {
  title: "TrackGo Admin",
  description: "Panel administrativo TrackGo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}