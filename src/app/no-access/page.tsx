"use client";

declare global {
    interface Window {
        __tgSplashDone?: () => void;
    }
}

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";

export default function NoAccessPage() {
    const router = useRouter();
    const { logout, profile } = useAuth();

    useEffect(() => {
        window.__tgSplashDone?.();
    }, []);

    async function exit() {
        await logout();
        router.replace("/login");
    }

    return (
        <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#f5f3ff_0,#f8f7ff_34%,#ffffff_100%)] px-4 py-8 text-[#172033]">
            <section className="w-full max-w-md rounded-2xl border border-[#e8e7fb] bg-white p-6 text-center shadow-[0_24px_70px_rgba(91,33,255,0.12)]">
                <TrackGoLogo variant="mark" size="lg" className="mx-auto justify-center" />

                <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">
                    Sin acceso
                </h1>
                <p className="mt-2 text-[13px] font-medium leading-6 text-[#667085]">
                    Tu usuario no tiene un perfil activo o permisos suficientes para entrar a esta zona.
                </p>

                {profile?.email ? (
                    <div className="mt-4 rounded-lg border border-[#eef1f5] bg-[#f9fafb] px-3 py-2 text-[12px] font-semibold text-[#344054]">
                        {profile.email}
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={exit}
                    className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[#e4e7ec] bg-white px-4 text-[13px] font-semibold text-[#344054] shadow-sm transition hover:bg-[#f9fafb] hover:text-[#172033]"
                >
                    Cerrar sesion
                </button>
            </section>
        </main>
    );
}
