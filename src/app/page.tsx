"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/AuthProvider";

declare global {
  interface Window {
    __tgSplashText?: (text: string) => void;
    __tgSplashDone?: () => void;
  }
}

export default function HomePage() {
  const router = useRouter();
  const { firebaseUser, isAdmin, isUser, loading } = useAuth();

  useEffect(() => {
    window.__tgSplashText?.("Restaurando sesión...");
  }, []);

  useEffect(() => {
    if (loading) return;

    if (!firebaseUser) {
      router.replace("/login");
      return;
    }

    if (isAdmin) {
      // Admin layout takes over the splash from here
      router.replace("/admin/accounting");
      return;
    }

    if (isUser) {
      // User layout takes over the splash from here
      router.replace("/user/leads");
      return;
    }

    router.replace("/no-access");
  }, [firebaseUser, isAdmin, isUser, loading, router]);

  // Splash covers everything — nothing to render
  return null;
}
