"use client";

import Link from "next/link";
import { VendorPushPrompt } from "@/components/mobile/VendorPushPrompt";
import { useAuth } from "@/features/auth/AuthProvider";

export default function UserSettingsPage() {
    const { firebaseUser, profile, userPermissions } = useAuth();
    const name = profile?.name || firebaseUser?.email || "Vendedor";

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
                        />
                    ) : null}
                    <SettingsTile
                        href="/user/settings/notifications"
                        title="Notificaciones"
                        body="Activa avisos de clientes nuevos y recordatorios operativos."
                        tone="blue"
                    />
                </div>

                <div className="rounded-3xl border border-[#e8e7fb] bg-white p-4 shadow-[0_16px_38px_rgba(91,33,255,0.08)]">
                    <p className="text-[13px] font-black">Cuenta</p>
                    <p className="mt-1 text-[12px] font-semibold text-[#66739a]">{firebaseUser?.email || "Sin correo"}</p>
                </div>
            </section>
        </main>
    );
}

function SettingsTile({ href, title, body, tone }: { href: string; title: string; body: string; tone: "purple" | "blue" }) {
    const cls = tone === "purple" ? "from-[#7c3aed] to-[#4f46e5]" : "from-[#2563eb] to-[#06b6d4]";
    return (
        <Link href={href} className="flex items-center gap-3 rounded-3xl border border-[#e8e7fb] bg-white p-4 shadow-[0_16px_38px_rgba(91,33,255,0.08)] active:scale-[0.99]">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${cls} text-white shadow-lg`}>
                {title.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-black text-[#101936]">{title}</span>
                <span className="mt-0.5 block text-[12px] font-semibold leading-snug text-[#66739a]">{body}</span>
            </span>
            <span className="text-[22px] font-black text-[#7c3aed]">›</span>
        </Link>
    );
}
