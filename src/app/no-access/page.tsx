"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/AuthProvider";

export default function NoAccessPage() {
    const router = useRouter();
    const { logout, profile } = useAuth();

    async function exit() {
        await logout();
        router.replace("/login");
    }

    return (
        <main className="grid min-h-screen place-items-center bg-[#f6f8fb] px-4 py-8 text-[#172033]">
            <section className="w-full max-w-md rounded-xl border border-[#e4e7ec] bg-white p-6 text-center shadow-sm">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[#fef2f2] text-[15px] font-bold text-[#dc2626]">
                    !
                </div>

                <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">
                    Sin acceso
                </h1>
                <p className="mt-2 text-[13px] font-medium leading-6 text-[#667085]">
                    Tu usuario no tiene permisos de administrador activo para entrar al panel.
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
