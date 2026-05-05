"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";
import { useAuth } from "@/features/auth/AuthProvider";

export default function LoginPage() {
    const router = useRouter();
    const { login, firebaseUser, isAdmin, isUser, loading } = useAuth();

    const [email, setEmail]       = useState("");
    const [password, setPassword] = useState("");
    const [saving, setSaving]     = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [error, setError]       = useState("");

    useEffect(() => {
        if (loading) return;
        if (firebaseUser && isAdmin) router.replace("/admin/accounting");
        else if (firebaseUser && isUser) router.replace("/user/leads");
        else if (firebaseUser) router.replace("/no-access");
    }, [loading, firebaseUser, isAdmin, isUser, router]);

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setError("");
        setSaving(true);
        setVerifying(false);
        try {
            await login(email, password);
            setVerifying(true);
        } catch {
            setVerifying(false);
            setError("Email o contraseña incorrectos.");
        } finally {
            setSaving(false);
        }
    }

    const cardProps = { email, password, saving, loading, verifying, error, onEmail: setEmail, onPassword: setPassword, onSubmit };

    return (
        <main
            className="relative min-h-screen overflow-hidden bg-[url('/brand/backgroundLoginTelefono.png')] bg-cover bg-center xl:bg-[url('/brand/backgroundLogin.png')] xl:bg-center"
        >
            {/* ── DESKTOP: landing izquierda + card derecha ───────────── */}
            <div className="hidden xl:flex xl:min-h-screen xl:items-center xl:justify-center xl:gap-20 xl:px-20">

                {/* LEFT */}
                <div className="w-[420px] shrink-0">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#E8E7FB] bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span className="text-[11px] font-bold text-[#66739A]">Plataforma activa</span>
                    </div>

                    <h1 className="mb-3 text-[38px] font-black leading-[1.12] tracking-[-0.03em] text-[#101936]">
                        Consigue clientes<br />
                        <span className="bg-gradient-to-r from-[#7C3AED] to-[#9333EA] bg-clip-text text-transparent">
                            listos para comprar
                        </span>
                    </h1>

                    <p className="mb-9 text-[14px] font-semibold leading-relaxed text-[#66739A]">
                        Conecta tu equipo con personas que ya quieren tu producto o servicio.
                    </p>

                    <div className="space-y-3.5">
                        <FeatureRow icon={<CheckIcon />} label="Clientes verificados y filtrados" />
                        <FeatureRow icon={<ZapIcon />}   label="Asignación automática, sin fricción" />
                        <FeatureRow icon={<ChartIcon />} label="Visitas y resultados en tiempo real" />
                    </div>
                </div>

                {/* RIGHT */}
                <LoginCard {...cardProps} />
            </div>

            {/* ── MOBILE: solo card centrada ───────────────────────────── */}
            <div className="relative flex min-h-screen flex-col items-center px-5 pb-6 pt-[max(env(safe-area-inset-top),4.75rem)] xl:hidden">
                <div className="mb-6 text-center">
                    <TrackGoLogo variant="mark" size="xl" className="mb-5 justify-center scale-[1.35]" />
                    <div className="text-[42px] font-black leading-none tracking-[-0.055em] text-[#08122f]">
                        Track<span className="bg-gradient-to-r from-[#5b21ff] to-[#8b2cff] bg-clip-text text-transparent">Go</span>
                    </div>
                    <p className="mx-auto mt-3 max-w-[230px] text-[13px] font-semibold leading-[1.35] text-[#7b8499]">
                        Monitorea lo que mas importa,<br />
                        en <span className="font-black text-[#6d28d9]">tiempo real.</span>
                    </p>
                </div>

                <LoginCard {...cardProps} variant="mobile" />
            </div>
        </main>
    );
}

// ── Login card ─────────────────────────────────────────────────────────────────

function LoginCard({
    email, password, saving, loading, verifying, error,
    onEmail, onPassword, onSubmit,
    variant = "desktop",
}: {
    email: string; password: string; saving: boolean; loading: boolean; verifying: boolean; error: string;
    onEmail: (v: string) => void; onPassword: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    variant?: "desktop" | "mobile";
}) {
    const [showPass, setShowPass] = useState(false);
    const isMobile = variant === "mobile";

    return (
        <div className={[
            "w-full shrink-0 border border-[#e8e7fb] bg-white/95 shadow-[0_24px_70px_rgba(91,33,255,0.13)] backdrop-blur",
            isMobile ? "max-w-[310px] rounded-[24px] px-5 pb-5 pt-6" : "max-w-[310px] rounded-2xl p-6",
        ].join(" ")}>

            {/* Logo centrado */}
            {isMobile ? (
                <div className="mb-5 text-center">
                    <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#08122f]">Bienvenido de nuevo</h1>
                    <p className="mt-2 text-[12px] font-semibold text-[#98a2b3]">Inicia sesion para continuar</p>
                </div>
            ) : (
                <div className="mb-6 flex justify-center">
                    <TrackGoLogo size="lg" />
                </div>
            )}

            <form onSubmit={onSubmit} className={isMobile ? "space-y-3.5" : "space-y-3"}>

                {/* Email */}
                <label className="block">
                    <span className={isMobile
                        ? "mb-1.5 block text-[12px] font-black text-[#08122f]"
                        : "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#667085]"
                    }>
                        {isMobile ? "Correo electronico" : "Email"}
                    </span>
                    <div className="relative">
                        <div className={isMobile
                            ? "pointer-events-none absolute inset-y-0 left-4 flex items-center text-[#98A2B3]"
                            : "pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#98A2B3]"
                        }>
                            <MailIcon />
                        </div>
                        <input
                            value={email}
                            onChange={(e) => onEmail(e.target.value)}
                            type="email"
                            autoComplete="email"
                            required
                            placeholder="admin@trackgo.com"
                            className={isMobile
                                ? "h-11 w-full rounded-[12px] border border-[#d9b8ff] bg-white/80 pl-11 pr-3 text-[14px] font-semibold text-[#172033] outline-none transition placeholder:text-[#98A2B3] focus:border-[#8b2cff] focus:ring-4 focus:ring-violet-100"
                                : "h-9 w-full rounded-lg border border-[#d8ddea] bg-white pl-9 pr-3 text-[12px] font-medium text-[#172033] outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                            }
                        />
                    </div>
                </label>

                {/* Contraseña */}
                <label className="block">
                    <span className={isMobile
                        ? "mb-1.5 block text-[12px] font-black text-[#08122f]"
                        : "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#667085]"
                    }>
                        Contraseña
                    </span>
                    <div className="relative">
                        <div className={isMobile
                            ? "pointer-events-none absolute inset-y-0 left-4 flex items-center text-[#98A2B3]"
                            : "pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#98A2B3]"
                        }>
                            <LockIcon />
                        </div>
                        <input
                            value={password}
                            onChange={(e) => onPassword(e.target.value)}
                            type={showPass ? "text" : "password"}
                            autoComplete="current-password"
                            required
                            placeholder="Tu contraseña"
                            className={isMobile
                                ? "h-11 w-full rounded-[12px] border border-[#d9b8ff] bg-white/80 pl-11 pr-10 text-[14px] font-semibold text-[#172033] outline-none transition placeholder:text-[#98A2B3] focus:border-[#8b2cff] focus:ring-4 focus:ring-violet-100"
                                : "h-9 w-full rounded-lg border border-[#d8ddea] bg-white pl-9 pr-9 text-[12px] font-medium text-[#172033] outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                            }
                        />
                        <button
                            type="button"
                            onClick={() => setShowPass((v) => !v)}
                            tabIndex={-1}
                            aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                            className={isMobile
                                ? "absolute inset-y-0 right-4 flex items-center text-[#98A2B3] transition hover:text-[#7C3AED]"
                                : "absolute inset-y-0 right-2.5 flex items-center text-[#98A2B3] transition hover:text-[#7C3AED]"
                            }
                        >
                            {showPass ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                    </div>
                </label>

                {isMobile ? (
                    <div className="flex items-center justify-between gap-3">
                        <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#66739a]">
                            <input type="checkbox" defaultChecked className="h-3.5 w-3.5 rounded border-[#d9b8ff] accent-[#7c3aed]" />
                            Recordarme
                        </label>
                        <button type="button" className="text-[11px] font-black text-[#7c3aed]">
                            Olvidaste tu contraseña?
                        </button>
                    </div>
                ) : null}

                {/* Error */}
                {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                        <AlertIcon />
                        <p className="text-[12px] font-semibold text-red-600">{error}</p>
                    </div>
                ) : null}

                {/* Botón */}
                <button
                    type="submit"
                    disabled={saving || loading || verifying}
                    className={isMobile
                        ? "group mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-[#6d28d9] bg-gradient-to-br from-[#8b2cff] via-[#7c3aed] to-[#5b21ff] text-[15px] font-black text-white shadow-[0_14px_26px_rgba(91,33,255,0.22)] transition active:scale-[0.99] disabled:opacity-60"
                        : "group mt-1 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-[#6d28d9] bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-[12px] font-semibold text-white shadow-[0_12px_28px_rgba(91,33,255,0.22)] transition hover:from-[#6d28d9] hover:to-[#4338ca] disabled:opacity-60"
                    }
                >
                    {saving ? <><SpinnerIcon /> Entrando...</> : verifying ? <><SpinnerIcon /> Verificando...</> : <>Entrar <ArrowRight /></>}
                </button>

                {verifying ? (
                    <p className="text-center text-[11px] font-semibold text-[#7b8499]">
                        Validando sesion y permisos...
                    </p>
                ) : null}
            </form>

            {/* Footer de la card */}
            <p className={isMobile
                ? "mt-5 flex items-center justify-center gap-1 text-[10px] font-semibold text-[#B0BAD0]"
                : "mt-3 flex items-center justify-center gap-1 text-[10px] font-semibold text-[#B0BAD0]"
            }>
                <LockTinyIcon /> Acceso seguro y privado
            </p>
            <p className={isMobile
                ? "mt-2 text-center text-[10px] font-semibold text-[#C8D0DC]"
                : "mt-2 text-center text-[10px] font-semibold text-[#C8D0DC]"
            }>
                © 2025 TrackGo
            </p>
        </div>
    );
}

// ── Feature row ────────────────────────────────────────────────────────────────

function FeatureRow({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/80 text-[#7C3AED] shadow-sm backdrop-blur-sm">
                {icon}
            </div>
            <span className="text-[13px] font-bold text-[#344054]">{label}</span>
        </div>
    );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const ic = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };

function CheckIcon()    { return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>; }
function ZapIcon()      { return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>; }
function ChartIcon()    { return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><path d="M18 20V10M12 20V4M6 20v-6"/></svg>; }
function MailIcon()     { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>; }
function LockIcon()     { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function EyeIcon()      { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>; }
function EyeOffIcon()   { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/></svg>; }
function AlertIcon()    { return <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" {...ic}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>; }
function LockTinyIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic} strokeWidth={2}><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function ArrowRight()   { return <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5"/></svg>; }
function SpinnerIcon()  { return <svg className="tg-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3.1-6.8"/></svg>; }
