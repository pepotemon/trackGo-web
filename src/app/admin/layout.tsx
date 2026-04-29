"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";

type NavIconName =
    | "activity"
    | "dashboard"
    | "inbox"
    | "spark"
    | "support"
    | "users"
    | "wallet"
    | "logOut";

const NAV_MAIN: { href: string; label: string; icon: NavIconName }[] = [
    { href: "/admin", label: "Dashboard", icon: "dashboard" },
    { href: "/admin/leads", label: "Leads", icon: "inbox" },
    { href: "/admin/activity", label: "Actividad", icon: "activity" },
    { href: "/admin/accounting", label: "Contabilidad", icon: "wallet" },
];

const NAV_SETTINGS: { href: string; label: string; icon: NavIconName }[] = [
    { href: "/admin/settings/users", label: "Usuarios", icon: "users" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const { firebaseUser, isAdmin, loading, logout } = useAuth();

    async function handleLogout() {
        await logout();
        router.replace("/login");
    }

    useEffect(() => {
        if (loading) return;

        if (!firebaseUser) {
            router.replace("/login");
            return;
        }

        if (!isAdmin) {
            router.replace("/no-access");
        }
    }, [firebaseUser, isAdmin, loading, router]);

    if (loading) {
        return <AdminAccessState title="Validando acceso" body="Estamos revisando tu sesion administrativa." />;
    }

    if (!firebaseUser) {
        return <AdminAccessState title="Redirigiendo" body="Necesitas iniciar sesion para entrar al panel." />;
    }

    if (!isAdmin) {
        return <AdminAccessState title="Sin acceso" body="Tu usuario no tiene permisos de administrador activo." />;
    }

    return (
        <div className="min-h-screen bg-[#f6f8fb] text-[#172033]">
            <aside className="fixed left-0 top-0 hidden h-screen w-[228px] border-r border-[#e4e7ec] bg-white px-3 py-4 xl:block">
                <div className="mb-5 flex items-center gap-2 border-b border-[#eef1f5] px-2 pb-4">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2563eb] text-[12px] font-bold text-white shadow-sm">
                        T
                    </div>

                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold leading-none text-[#172033]">
                            TrackGo
                        </p>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98a2b3]">
                            Admin OS
                        </p>
                    </div>
                </div>

                <div className="mb-4">
                    <div className="flex h-8 items-center gap-2 rounded-lg border border-[#e4e7ec] bg-[#f9fafb] px-2 text-[#667085] shadow-sm">
                        <span className="text-[12px]">/</span>
                        <span className="text-[12px] font-medium">Buscar</span>
                        <span className="ml-auto rounded border border-[#e4e7ec] bg-white px-1.5 py-0.5 text-[10px] text-[#98a2b3]">
                            K
                        </span>
                    </div>
                </div>

                <nav className="space-y-5">
                    <NavSection title="Reportes" items={NAV_MAIN} />
                    <NavSection title="Configurar" items={NAV_SETTINGS} />
                </nav>

                <div className="absolute bottom-4 left-3 right-3 space-y-1">
                    <SidebarFooterLink label="Soporte" icon="support" />
                    <SidebarFooterLink label="Novedades" icon="spark" />
                    <SidebarFooterAction label="Cerrar sesion" icon="logOut" onClick={handleLogout} />

                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#e4e7ec] bg-[#f9fafb] px-2 py-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#172033] text-[10px] font-bold text-white">
                            C
                        </div>
                        <div>
                            <span className="block text-[12px] font-semibold text-[#172033]">
                                Admin
                            </span>
                            <span className="block text-[10px] font-medium text-[#667085]">
                                Operacion
                            </span>
                        </div>
                    </div>
                </div>
            </aside>

            <div className="xl:pl-[228px]">
                <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#e4e7ec] bg-white/90 px-4 backdrop-blur-xl xl:hidden">
                    <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2563eb] text-[12px] font-bold text-white">
                            T
                        </div>
                        <p className="text-[14px] font-semibold">TrackGo</p>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto">
                        <MobileLink href="/admin" label="Dash" />
                        <MobileLink href="/admin/leads" label="Leads" />
                        <MobileLink href="/admin/activity" label="Act." />
                        <MobileLink href="/admin/accounting" label="Conta." />
                        <MobileLink href="/admin/settings/users" label="Usuarios" />
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="rounded-lg border border-[#e4e7ec] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#344054] shadow-sm"
                        >
                            Salir
                        </button>
                    </div>
                </div>

                <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-7">
                    {children}
                </main>
            </div>
        </div>
    );
}

function AdminAccessState({ title, body }: { title: string; body: string }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-6 text-[#172033]">
            <div className="w-full max-w-sm rounded-lg border border-[#e4e7ec] bg-white p-5 text-center shadow-sm">
                <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563eb] text-[12px] font-bold text-white">
                    T
                </div>
                <h1 className="text-[16px] font-semibold">{title}</h1>
                <p className="mt-1 text-[13px] font-medium text-[#667085]">{body}</p>
            </div>
        </main>
    );
}

function NavSection({
    title,
    items,
}: {
    title: string;
    items: { href: string; label: string; icon: NavIconName }[];
}) {
    return (
        <div>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98a2b3]">
                {title}
            </p>

            <div className="space-y-0.5">
                {items.map((item) => (
                    <NavItem key={item.href} {...item} />
                ))}
            </div>
        </div>
    );
}

function NavItem({
    href,
    label,
    icon,
}: {
    href: string;
    label: string;
    icon: NavIconName;
}) {
    return (
        <Link
            href={href}
            className="group flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] font-semibold text-[#667085] transition hover:bg-[#eff6ff] hover:text-[#2563eb]"
        >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#f2f4f7] text-[#667085] transition group-hover:text-[#2563eb]">
                <NavIcon name={icon} />
            </span>
            <span>{label}</span>
        </Link>
    );
}

function SidebarFooterLink({ label, icon }: { label: string; icon: NavIconName }) {
    return (
        <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-[#667085] transition hover:bg-[#f2f4f7] hover:text-[#172033]"
        >
            <span className="flex h-5 w-5 items-center justify-center text-[#98a2b3]">
                <NavIcon name={icon} />
            </span>
            <span>{label}</span>
        </button>
    );
}

function SidebarFooterAction({
    label,
    icon,
    onClick,
}: {
    label: string;
    icon: NavIconName;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-[#dc2626] transition hover:bg-[#fef2f2]"
        >
            <span className="flex h-5 w-5 items-center justify-center text-[#dc2626]">
                <NavIcon name={icon} />
            </span>
            <span>{label}</span>
        </button>
    );
}

function MobileLink({ href, label }: { href: string; label: string }) {
    return (
        <Link
            href={href}
            className="rounded-lg border border-[#e4e7ec] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#344054] shadow-sm"
        >
            {label}
        </Link>
    );
}

function NavIcon({ name }: { name: NavIconName }) {
    const common = {
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        strokeWidth: 1.8,
    };

    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5">
            {name === "dashboard" ? (
                <>
                    <rect {...common} x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect {...common} x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect {...common} x="3" y="14" width="7" height="7" rx="1.5" />
                    <path {...common} d="M14 17.5h7M17.5 14v7" />
                </>
            ) : null}
            {name === "inbox" ? (
                <>
                    <path {...common} d="M4 4h16l-2 9H6L4 4Z" />
                    <path {...common} d="M6 13v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" />
                    <path {...common} d="M9 16h6" />
                </>
            ) : null}
            {name === "activity" ? <path {...common} d="M22 12h-4l-3 8L9 4l-3 8H2" /> : null}
            {name === "wallet" ? (
                <>
                    <path {...common} d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" />
                    <path {...common} d="M16 14h5" />
                </>
            ) : null}
            {name === "logOut" ? (
                <>
                    <path {...common} d="M10 17l5-5-5-5" />
                    <path {...common} d="M15 12H3" />
                    <path {...common} d="M21 19V5a2 2 0 0 0-2-2h-6" />
                </>
            ) : null}
            {name === "users" ? (
                <>
                    <path {...common} d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
                    <circle {...common} cx="9" cy="7" r="4" />
                    <path {...common} d="M22 20v-1.5a4 4 0 0 0-3-3.8" />
                    <path {...common} d="M16 3.3a4 4 0 0 1 0 7.4" />
                </>
            ) : null}
            {name === "support" ? (
                <>
                    <circle {...common} cx="12" cy="12" r="9" />
                    <path {...common} d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 2-2.3 2.1-2.3 4" />
                    <path {...common} d="M12 17h.01" />
                </>
            ) : null}
            {name === "spark" ? (
                <>
                    <path {...common} d="M12 3l1.8 5.1L19 10l-5.2 1.9L12 17l-1.8-5.1L5 10l5.2-1.9L12 3Z" />
                    <path {...common} d="M5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8L5 16Z" />
                </>
            ) : null}
        </svg>
    );
}
