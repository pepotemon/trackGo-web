"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";
import { useAuth } from "@/features/auth/AuthProvider";

export default function LoginPage() {
    const router = useRouter();
    const { login, firebaseUser, isAdmin, isUser, loading } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (loading) return;
        if (firebaseUser && isAdmin) router.replace("/admin/accounting");
        else if (firebaseUser && isUser) router.replace("/user/leads");
    }, [loading, firebaseUser, isAdmin, isUser, router]);

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
        <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#f3e8ff_0,#f8f7ff_34%,#ffffff_100%)] px-4 py-8 text-[#172033]">
            <form
                onSubmit={onSubmit}
                className="w-full max-w-[320px] rounded-2xl border border-[#e8e7fb] bg-white/92 p-5 shadow-[0_24px_70px_rgba(91,33,255,0.12)] backdrop-blur"
            >
                <div className="mb-5 flex justify-center">
                    <TrackGoLogo size="xl" />
                </div>

                <div className="space-y-3">
                    <label className="block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                            Email
                        </span>
                        <input
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            type="email"
                            autoComplete="email"
                            className="mt-1.5 h-9 w-full rounded-lg border border-[#d8ddea] bg-white px-3 text-[12px] font-medium text-[#172033] outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
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
                            className="mt-1.5 h-9 w-full rounded-lg border border-[#d8ddea] bg-white px-3 text-[12px] font-medium text-[#172033] outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
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
                    className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-lg border border-[#6d28d9] bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] px-4 text-[12px] font-semibold text-white shadow-[0_12px_28px_rgba(91,33,255,0.22)] transition hover:from-[#6d28d9] hover:to-[#4338ca] disabled:opacity-60"
                >
                    {saving ? "Entrando..." : "Entrar"}
                </button>
            </form>
        </main>
    );
}
