"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function LoginPage() {
    const router = useRouter();
    const { login, firebaseUser, isAdmin, loading } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!loading && firebaseUser && isAdmin) {
            router.replace("/admin/accounting");
        }
    }, [loading, firebaseUser, isAdmin, router]);

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setError("");
        setSaving(true);

        try {
            await login(email, password);
        } catch (err: any) {
            setError("Email o contraseña incorrectos.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="min-h-screen bg-slate-950 text-white grid place-items-center px-4">
            <form
                onSubmit={onSubmit}
                className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl"
            >
                <div className="mb-6">
                    <p className="text-sm font-bold text-sky-300">TrackGo Web</p>
                    <h1 className="mt-2 text-3xl font-black">Panel administrativo</h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Acceso solo para administradores activos.
                    </p>
                </div>

                <div className="space-y-4">
                    <label className="block">
                        <span className="text-xs font-bold text-slate-400">Email</span>
                        <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            type="email"
                            autoComplete="email"
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-sky-400"
                            placeholder="admin@trackgo.com"
                        />
                    </label>

                    <label className="block">
                        <span className="text-xs font-bold text-slate-400">Contraseña</span>
                        <input
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            type="password"
                            autoComplete="current-password"
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-sky-400"
                            placeholder="••••••••"
                        />
                    </label>
                </div>

                {error ? (
                    <p className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
                        {error}
                    </p>
                ) : null}

                <button
                    disabled={saving}
                    className="mt-6 w-full rounded-2xl bg-sky-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-sky-400 disabled:opacity-60"
                >
                    {saving ? "Entrando..." : "Entrar"}
                </button>
            </form>
        </main>
    );
}