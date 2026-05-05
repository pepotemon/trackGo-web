"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";
import { useAuth } from "@/features/auth/AuthProvider";

export default function HomePage() {
  const router = useRouter();
  const { firebaseUser, isAdmin, isUser, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!firebaseUser) {
      router.replace("/login");
      return;
    }

    if (isAdmin) {
      router.replace("/admin/accounting");
      return;
    }

    if (isUser) {
      router.replace("/user/leads");
      return;
    }

    router.replace("/no-access");
  }, [firebaseUser, isAdmin, isUser, loading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f5f3ff_0,#f8f7ff_34%,#ffffff_100%)] p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[#e8e7fb] bg-white p-6 text-center shadow-[0_24px_70px_rgba(91,33,255,0.12)]">
        <TrackGoLogo variant="mark" size="lg" className="mx-auto mb-4 justify-center" />
        <p className="text-[13px] font-semibold text-[#667085]">Restaurando tu sesión...</p>
      </div>
    </main>
  );
}
