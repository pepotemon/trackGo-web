"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";

export default function LoginPage() {
    const router = useRouter();
    const { login, firebaseUser, isAdmin, loading } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!loading && firebaseUser && isAdmin) {
            router.replace("/admin");
        }
    }, [loading, firebaseUser, isAdmin, router]);

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        setError("");
        setSaving(true);

        try {
            await login(email, password);
        } catch {
            setError("Email o contrasena incorrectos.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="grid min-h-screen place-items-center bg-[#f6f8fb] px-4 py-8 text-[#172033]">
            <section className="grid w-full max-w-[960px] overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-sm lg:grid-cols-[0.95fr_1.05fr]">
                <aside className="border-b border-[#eef1f5] bg-[#f9fafb] p-6 lg:border-b-0 lg:border-r">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563eb] text-[13px] font-bold text-white">
                            T
                        </div>
                        <div>
                            <p className="text-[14px] font-semibold leading-none">TrackGo</p>
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98a2b3]">
                                Admin OS
                            </p>
                        </div>
                    </div>

                    <div className="mt-10">
                        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">
                            Panel administrativo
                        </h1>
                        <p className="mt-3 max-w-sm text-[13px] font-medium leading-6 text-[#667085]">
                            Gestiona leads, usuarios, actividad y contabilidad desde una consola centralizada.
                        </p>
                    </div>

                    <div className="mt-8 grid gap-2">
                        <AccessPoint label="Acceso protegido" />
                        <AccessPoint label="Solo administradores activos" />
                        <AccessPoint label="Firebase Auth + Firestore" />
                    </div>
                </aside>

                <form onSubmit={onSubmit} className="p-6 sm:p-8">
                    <div>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                            Iniciar sesion
                        </p>
                        <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.02em]">
                            Entra a TrackGo
                        </h2>
                    </div>

                    <div className="mt-6 space-y-4">
                        <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                                Email
                            </span>
                            <input
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                type="email"
                                autoComplete="email"
                                className="mt-1.5 h-10 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 text-[13px] font-medium text-[#172033] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-blue-100"
                                placeholder="admin@trackgo.com"
                            />
                        </label>

                        <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                                Contrasena
                            </span>
                            <input
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                type="password"
                                autoComplete="current-password"
                                className="mt-1.5 h-10 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 text-[13px] font-medium text-[#172033] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-blue-100"
                                placeholder="Tu contrasena"
                            />
                        </label>
                    </div>

                    {error ? (
                        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-600">
                            {error}
                        </p>
                    ) : null}

                    <button
                        disabled={saving || loading}
                        className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[#2563eb] bg-[#2563eb] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-60"
                    >
                        {saving ? "Entrando..." : "Entrar"}
                    </button>
                </form>
            </section>
        </main>
    );
}

function AccessPoint({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-[#e4e7ec] bg-white px-3 py-2 text-[12px] font-semibold text-[#344054]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2563eb]" />
            {label}
        </div>
    );
}
