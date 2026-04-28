"use client";

import { useAuth } from "@/features/auth/AuthProvider";

export default function NoAccessPage() {
    const { logout } = useAuth();

    return (
        <main className="min-h-screen bg-slate-950 text-white grid place-items-center px-4">
            <div className="max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center">
                <h1 className="text-2xl font-black">Sin acceso</h1>
                <p className="mt-3 text-sm text-slate-400">
                    Tu usuario no tiene permisos de administrador o está inactivo.
                </p>

                <button
                    onClick={logout}
                    className="mt-6 rounded-2xl bg-white/10 px-5 py-3 text-sm font-black hover:bg-white/15"
                >
                    Cerrar sesión
                </button>
            </div>
        </main>
    );
}