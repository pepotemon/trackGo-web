"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { VendorPushPrompt } from "@/components/mobile/VendorPushPrompt";
import { useAuth } from "@/features/auth/AuthProvider";
import { useVendorSubscriptionStatus, type VendorSubscriptionStatus } from "@/features/subscriptions/useVendorSubscriptionStatus";
import { updateUserProfile } from "@/data/usersRepo";
import { auth } from "@/lib/firebase";

export default function UserSettingsPage() {
    const { firebaseUser, profile, userPermissions, logout } = useAuth();
    const router = useRouter();
    const subscriptionStatus = useVendorSubscriptionStatus(userPermissions.canSeeSubscriptions ? firebaseUser?.uid : null);

    // profile sheet
    const [profileOpen, setProfileOpen] = useState(false);
    const [profileName, setProfileName] = useState("");
    const [profilePhone, setProfilePhone] = useState("");
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileError, setProfileError] = useState("");
    const [profileSuccess, setProfileSuccess] = useState(false);

    // password sheet
    const [passwordOpen, setPasswordOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [passwordError, setPasswordError] = useState("");
    const [passwordSuccess, setPasswordSuccess] = useState(false);

    async function handleLogout() {
        await logout();
        router.replace("/login");
    }
    const name = profile?.name || firebaseUser?.email || "Vendedor";

    function openProfile() {
        setProfileName(profile?.name ?? "");
        setProfilePhone(profile?.whatsappPhone ?? "");
        setProfileError("");
        setProfileSuccess(false);
        setProfileOpen(true);
    }

    async function saveProfile() {
        if (!firebaseUser) return;
        setProfileSaving(true);
        setProfileError("");
        try {
            await updateUserProfile(firebaseUser.uid, { name: profileName.trim(), whatsappPhone: profilePhone.trim() });
            setProfileSuccess(true);
            window.setTimeout(() => { setProfileOpen(false); setProfileSuccess(false); }, 900);
        } catch {
            setProfileError("No se pudo guardar. Intenta nuevamente.");
        } finally {
            setProfileSaving(false);
        }
    }

    function openPassword() {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordError("");
        setPasswordSuccess(false);
        setPasswordOpen(true);
    }

    async function savePassword() {
        if (!firebaseUser?.email) return;
        if (newPassword.length < 6) { setPasswordError("La nueva contraseña debe tener al menos 6 caracteres."); return; }
        if (newPassword !== confirmPassword) { setPasswordError("Las contraseñas no coinciden."); return; }
        setPasswordSaving(true);
        setPasswordError("");
        try {
            const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
            await reauthenticateWithCredential(auth.currentUser!, credential);
            await updatePassword(auth.currentUser!, newPassword);
            setPasswordSuccess(true);
            window.setTimeout(() => { setPasswordOpen(false); setPasswordSuccess(false); }, 900);
        } catch (err) {
            const code = (err as { code?: string }).code;
            if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
                setPasswordError("La contraseña actual es incorrecta.");
            } else if (code === "auth/too-many-requests") {
                setPasswordError("Demasiados intentos. Intenta mas tarde.");
            } else {
                setPasswordError("No se pudo cambiar la contraseña. Intenta nuevamente.");
            }
        } finally {
            setPasswordSaving(false);
        }
    }

    return (
        <main className="min-h-screen bg-[linear-gradient(180deg,#fbfaff_0%,#f6f3ff_55%,#ffffff_100%)] px-4 pb-24 pt-5 text-[#101936] xl:px-8">
            {firebaseUser ? <VendorPushPrompt userId={firebaseUser.uid} /> : null}
            <section className="mx-auto max-w-2xl space-y-4">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7c70ba]">Configuracion</p>
                    <h1 className="mt-1 text-[30px] font-black tracking-[-0.06em]">Hola, {name.split(" ")[0]}</h1>
                    <p className="mt-1 text-[13px] font-semibold text-[#66739a]">Gestiona tu cuenta, avisos y suscripciones de campana.</p>
                </div>

                <div className="grid gap-3">
                    {userPermissions.canSeeSubscriptions ? (
                        <SettingsTile
                            href="/user/settings/subscriptions"
                            title="Suscripciones"
                            body="Compra una ciudad disponible por Pix y activa tu campana de 5 dias."
                            tone="purple"
                            status={subscriptionStatus}
                        />
                    ) : null}
                    <SettingsTile
                        href="/user/settings/notifications"
                        title="Notificaciones"
                        body="Activa avisos de clientes nuevos y recordatorios operativos."
                        tone="blue"
                    />
                    {userPermissions.canSeeHistory ? (
                        <SettingsTile
                            href="/user/history"
                            title="Historial"
                            body="Revisa el registro de visitas y rechazos de semanas anteriores."
                            tone="green"
                        />
                    ) : null}
                    <SettingsTile
                        onClick={openProfile}
                        title="Mi perfil"
                        body="Actualiza tu nombre y numero de WhatsApp."
                        tone="teal"
                    />
                    <SettingsTile
                        onClick={openPassword}
                        title="Cambiar contraseña"
                        body="Actualiza tu contraseña de acceso."
                        tone="slate"
                    />
                </div>

                <div className="rounded-3xl border border-[#e8e7fb] bg-white p-4 shadow-[0_16px_38px_rgba(91,33,255,0.08)]">
                    <p className="text-[13px] font-black">Cuenta</p>
                    <p className="mt-1 text-[12px] font-semibold text-[#66739a]">{firebaseUser?.email || "Sin correo"}</p>
                </div>

                <button
                    type="button"
                    onClick={handleLogout}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-3xl border border-red-200 bg-red-50 text-[14px] font-black text-red-600 shadow-sm transition active:scale-[0.99] active:bg-red-100"
                >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}>
                        <path d="M10 17l5-5-5-5" />
                        <path d="M15 12H3" />
                        <path d="M21 19V5a2 2 0 0 0-2-2h-6" />
                    </svg>
                    Cerrar sesión
                </button>
            </section>

            {/* ── PROFILE SHEET ─────────────────────────────────────────── */}
            {profileOpen ? (
                <BottomSheet onClose={() => setProfileOpen(false)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-black text-teal-700">MI PERFIL</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">Editar perfil</p>
                    </div>
                    <div className="space-y-3">
                        <label className="block">
                            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.06em] text-[#98a2b3]">Nombre</span>
                            <input
                                type="text"
                                value={profileName}
                                onChange={(e) => setProfileName(e.target.value)}
                                placeholder="Tu nombre completo"
                                className="h-11 w-full rounded-[14px] border border-[#e8e7fb] bg-[#f8f7ff] px-3 text-[14px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.06em] text-[#98a2b3]">Numero de WhatsApp</span>
                            <input
                                type="tel"
                                value={profilePhone}
                                onChange={(e) => setProfilePhone(e.target.value)}
                                placeholder="Ej: 5511999999999"
                                className="h-11 w-full rounded-[14px] border border-[#e8e7fb] bg-[#f8f7ff] px-3 text-[14px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                    </div>
                    {profileError ? (
                        <p className="mt-3 rounded-[12px] border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">{profileError}</p>
                    ) : null}
                    {profileSuccess ? (
                        <p className="mt-3 rounded-[12px] border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700">Guardado correctamente.</p>
                    ) : null}
                    <div className="mt-4 flex gap-2">
                        <button type="button" onClick={() => setProfileOpen(false)} className="flex-1 rounded-[14px] border border-[#e8e7fb] py-3 text-[13px] font-black text-[#66739a]">Cancelar</button>
                        <button type="button" onClick={saveProfile} disabled={profileSaving} className="flex-1 rounded-[14px] bg-[#7c3aed] py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {profileSaving ? "Guardando..." : "Guardar"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {/* ── PASSWORD SHEET ────────────────────────────────────────── */}
            {passwordOpen ? (
                <BottomSheet onClose={() => setPasswordOpen(false)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">CONTRASEÑA</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">Cambiar contraseña</p>
                    </div>
                    <div className="space-y-3">
                        <label className="block">
                            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.06em] text-[#98a2b3]">Contraseña actual</span>
                            <input
                                type="password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                placeholder="Tu contraseña actual"
                                className="h-11 w-full rounded-[14px] border border-[#e8e7fb] bg-[#f8f7ff] px-3 text-[14px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.06em] text-[#98a2b3]">Nueva contraseña</span>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Min. 6 caracteres"
                                className="h-11 w-full rounded-[14px] border border-[#e8e7fb] bg-[#f8f7ff] px-3 text-[14px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.06em] text-[#98a2b3]">Confirmar nueva contraseña</span>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Repite la nueva contraseña"
                                className="h-11 w-full rounded-[14px] border border-[#e8e7fb] bg-[#f8f7ff] px-3 text-[14px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                    </div>
                    {passwordError ? (
                        <p className="mt-3 rounded-[12px] border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">{passwordError}</p>
                    ) : null}
                    {passwordSuccess ? (
                        <p className="mt-3 rounded-[12px] border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700">Contraseña actualizada correctamente.</p>
                    ) : null}
                    <div className="mt-4 flex gap-2">
                        <button type="button" onClick={() => setPasswordOpen(false)} className="flex-1 rounded-[14px] border border-[#e8e7fb] py-3 text-[13px] font-black text-[#66739a]">Cancelar</button>
                        <button type="button" onClick={savePassword} disabled={passwordSaving} className="flex-1 rounded-[14px] bg-[#7c3aed] py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {passwordSaving ? "Guardando..." : "Cambiar"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}
        </main>
    );
}

type SettingsTone = "purple" | "blue" | "green" | "teal" | "slate";

function SettingsTile({
    href,
    onClick,
    title,
    body,
    tone,
    status,
}: {
    href?: string;
    onClick?: () => void;
    title: string;
    body: string;
    tone: SettingsTone;
    status?: VendorSubscriptionStatus;
}) {
    const gradients: Record<SettingsTone, string> = {
        purple: "from-[#7c3aed] to-[#4f46e5]",
        blue: "from-[#2563eb] to-[#06b6d4]",
        green: "from-[#059669] to-[#10b981]",
        teal: "from-[#0d9488] to-[#06b6d4]",
        slate: "from-[#475569] to-[#64748b]",
    };
    const cls = gradients[tone];
    const inner = (
        <>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${cls} text-white shadow-lg`}>
                {title.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                    <span className="block text-[15px] font-black text-[#101936]">{title}</span>
                    {status ? <SubscriptionStatusPill status={status} /> : null}
                </span>
                <span className="mt-0.5 block text-[12px] font-semibold leading-snug text-[#66739a]">{body}</span>
            </span>
            <span className="text-[22px] font-black text-[#7c3aed]">›</span>
        </>
    );

    if (href) {
        return (
            <Link href={href} className="flex items-center gap-3 rounded-3xl border border-[#e8e7fb] bg-white p-4 shadow-[0_16px_38px_rgba(91,33,255,0.08)] active:scale-[0.99]">
                {inner}
            </Link>
        );
    }
    return (
        <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-3xl border border-[#e8e7fb] bg-white p-4 shadow-[0_16px_38px_rgba(91,33,255,0.08)] active:scale-[0.99]">
            {inner}
        </button>
    );
}

function SubscriptionStatusPill({ status }: { status: VendorSubscriptionStatus }) {
    const active = status === "active";
    const loading = status === "loading";
    return (
        <span className={[
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ring-1",
            active
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : loading
                  ? "bg-slate-50 text-slate-500 ring-slate-100"
                  : "bg-rose-50 text-rose-600 ring-rose-100",
        ].join(" ")}>
            <span className={[
                "h-1.5 w-1.5 rounded-full",
                active ? "bg-emerald-500" : loading ? "bg-slate-300" : "bg-rose-400",
                active ? "animate-pulse" : "",
            ].join(" ")} />
            {active ? "Activo" : loading ? "..." : "Inactivo"}
        </span>
    );
}

function BottomSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-end xl:items-center xl:justify-center">
            <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full overflow-y-auto rounded-t-[24px] bg-white px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4 shadow-2xl xl:max-w-md xl:rounded-[24px]">
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#e8e7fb] xl:hidden" />
                {children}
            </div>
        </div>
    );
}
