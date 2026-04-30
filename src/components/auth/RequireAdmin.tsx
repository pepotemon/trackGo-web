"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { firebaseUser, profile, loading, isAdmin } = useAuth();

    useEffect(() => {
        if (loading) return;

        if (!firebaseUser) {
            router.replace("/login");
            return;
        }

        if (!profile || !isAdmin) {
            router.replace("/no-access");
        }
    }, [firebaseUser, profile, loading, isAdmin, router]);

    if (loading) {
        return (
            <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#f5f3ff_0,#f8f7ff_34%,#ffffff_100%)] text-[#101936]">
                <div className="rounded-2xl border border-[#e8e7fb] bg-white p-6 text-center shadow-[0_24px_70px_rgba(91,33,255,0.12)]">
                    <TrackGoLogo variant="mark" size="lg" className="mx-auto mb-4 justify-center" />
                    <p className="text-sm font-semibold text-[#66739a]">Cargando TrackGo...</p>
                </div>
            </main>
        );
    }

    if (!firebaseUser || !profile || !isAdmin) return null;

    return <>{children}</>;
}
