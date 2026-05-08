"use client";

import Link from "next/link";
import { AppIcon } from "@/components/ui/AppIcon";
import { PageHeader } from "@/components/ui/PageHeader";
import { usePermissions } from "@/features/auth/usePermissions";

export default function AdminSettingsPage() {
    const permissions = usePermissions();

    const items: Array<{ href: string; title: string; body: string; icon: "users" | "wallet" | "alert"; tone: "purple" | "blue"; visible: boolean }> = [
        {
            href: "/admin/settings/users",
            title: "Usuarios",
            body: "Permisos, socios, cobertura, tarifas y acceso operativo.",
            icon: "users",
            tone: "blue",
            visible: permissions.usersView,
        },
        {
            href: "/admin/settings/subscriptions",
            title: "Suscripciones",
            body: "Ciudades, campañas Meta, reglas comerciales y auditoría Pix.",
            icon: "wallet",
            tone: "purple",
            visible: permissions.subscriptionsView || permissions.subscriptionsEdit,
        },
        {
            href: "/admin/settings/notifications",
            title: "Notificaciones",
            body: "Activa o desactiva avisos push en este dispositivo.",
            icon: "alert",
            tone: "blue",
            visible: true,
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
                            <AppIcon name={item.icon} className="h-5 w-5" />
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
        </main>
    );
}
