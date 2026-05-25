"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppIcon } from "@/components/ui/AppIcon";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePermissions } from "@/features/auth/usePermissions";

export default function AdminSettingsPage() {
    const permissions = usePermissions();
    const { logout } = useAuth();
    const router = useRouter();

    async function handleLogout() {
        await logout();
        router.replace("/login");
    }

    const items: Array<{ href: string; title: string; body: string; tone: "purple" | "blue"; visible: boolean }> = [
        {
            href: "/admin/settings/users",
            title: "Usuarios",
            body: "Permisos, socios, cobertura, tarifas y acceso operativo.",
            tone: "blue",
            visible: permissions.usersView,
        },
        {
            href: "/admin/settings/subscriptions",
            title: "Suscripciones",
            body: "Ciudades, campañas Meta, reglas comerciales y auditoría Pix.",
            tone: "purple",
            visible: permissions.subscriptionsView || permissions.subscriptionsEdit,
        },
        {
            href: "/admin/settings/commercial-directory",
            title: "Directorio Comercial",
            body: "Base publica de prospectos por pais, ciudad, barrio y categoria.",
            tone: "blue",
            visible: permissions.commercialDirectoryView || permissions.commercialDirectoryEdit,
        },
        {
            href: "/admin/settings/debts",
            title: "Cartera de Cobros",
            body: "Control privado de deudas, abonos y saldos por administrador.",
            tone: "purple",
            visible: true,
        },
        {
            href: "/admin/settings/notifications",
            title: "Notificaciones",
            body: "Activa o desactiva avisos push en este dispositivo.",
            tone: "blue",
            visible: true,
        },
        {
            href: "/admin/gastos",
            title: "Gastos",
            body: "Gastos de mantenimiento de plataforma que reducen la ganancia real.",
            tone: "purple",
            visible: permissions.gastosView,
        },
    ];

    const visibleItems = items.filter((item) => item.visible);

    return (
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-4">
            <PageHeader
                icon={<AppIcon name="settings" plain className="h-5 w-5 text-current" />}
                title="Configuración"
                subtitle="Centro operativo para administrar accesos, reglas y módulos sensibles."
            />

            <section className="grid gap-3 sm:grid-cols-2">
                {visibleItems.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-3 rounded-3xl border border-[#e8e7fb] bg-white p-4 shadow-[0_16px_38px_rgba(91,33,255,0.08)] transition active:scale-[0.99]"
                    >
                        <span className={[
                            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg",
                            item.tone === "purple"
                                ? "bg-gradient-to-br from-[#7c3aed] to-[#4f46e5]"
                                : "bg-gradient-to-br from-[#2563eb] to-[#06b6d4]",
                        ].join(" ")}>
                            {item.title.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-black text-[#101936]">{item.title}</span>
                            <span className="mt-0.5 block text-[12px] font-semibold leading-snug text-[#66739a]">{item.body}</span>
                        </span>
                        <span className="text-[22px] font-black text-[#7c3aed]">›</span>
                    </Link>
                ))}
            </section>

            {visibleItems.length === 0 ? (
                <section className="rounded-[24px] border border-[#e8e7fb] bg-white p-5 text-center shadow-sm">
                    <p className="text-[14px] font-black text-[#101936]">Sin módulos disponibles</p>
                    <p className="mt-1 text-[12px] font-semibold text-[#66739a]">
                        Tu usuario no tiene permisos para administrar configuración.
                    </p>
                </section>
            ) : null}

            <section>
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
        </main>
    );
}
