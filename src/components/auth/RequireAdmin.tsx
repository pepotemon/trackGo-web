"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
            <main className="min-h-screen bg-slate-950 text-white grid place-items-center">
                <p className="text-sm text-slate-400">Cargando TrackGo...</p>
            </main>
        );
    }

    if (!firebaseUser || !profile || !isAdmin) return null;

    return <>{children}</>;
}