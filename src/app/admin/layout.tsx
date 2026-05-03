"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePermissions } from "@/features/auth/usePermissions";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";

type NavIconName =
    | "activity"
    | "dashboard"
    | "inbox"
    | "more"
    | "search"
    | "users"
    | "wallet"
    | "logOut";

const NAV_MAIN: { href: string; label: string; icon: NavIconName }[] = [
    { href: "/admin", label: "Dashboard", icon: "dashboard" },
    { href: "/admin/leads", label: "Prospectos", icon: "inbox" },
    { href: "/admin/activity", label: "Actividad", icon: "activity" },
    { href: "/admin/accounting", label: "Contabilidad", icon: "wallet" },
];

const NAV_SETTINGS: { href: string; label: string; icon: NavIconName }[] = [
    { href: "/admin/settings/users", label: "Usuarios", icon: "users" },
];

const MOBILE_NAV: { href: string; label: string; icon: NavIconName }[] = [
    { href: "/admin/leads", label: "Prospectos", icon: "inbox" },
    { href: "/admin/activity", label: "Actividad", icon: "activity" },
    { href: "/admin/accounting", label: "Conta", icon: "wallet" },
    { href: "/admin/settings/users", label: "Usuarios", icon: "users" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { firebaseUser, isAdmin, loading, logout } = useAuth();
    const permissions = usePermissions();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [now, setNow] = useState(() => new Date());

    const adminLabel = useMemo(() => {
        return firebaseUser?.displayName || firebaseUser?.email || "Admin";
    }, [firebaseUser]);

    const liveDate = useMemo(() => {
        return new Intl.DateTimeFormat("es", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
        }).format(now);
    }, [now]);

    const visibleMainNav = NAV_MAIN.filter((item) => {
        if (item.href === "/admin/leads") return permissions.prospectos;
        if (item.href === "/admin/activity") return permissions.actividad;
        if (item.href === "/admin/accounting") return permissions.accountingView;
        return true;
    });
    const visibleSettingsNav = NAV_SETTINGS.filter((item) => {
        if (item.href === "/admin/settings/users") return permissions.usersView;
        return true;
    });
    const visibleMobileNav = MOBILE_NAV.filter((item) => {
        if (item.href === "/admin/leads") return permissions.prospectos;
        if (item.href === "/admin/activity") return permissions.actividad;
        if (item.href === "/admin/accounting") return permissions.accountingView;
        if (item.href === "/admin/settings/users") return permissions.usersView;
        return true;
    });

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

    useEffect(() => {
        const id = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(id);
    }, []);

    if (loading) {
        return <AdminAccessState title="Validando acceso" body="Estamos revisando tu sesión administrativa." />;
    }

    if (!firebaseUser) {
        return <AdminAccessState title="Redirigiendo" body="Necesitas iniciar sesión para entrar al panel." />;
    }

    if (!isAdmin) {
        return <AdminAccessState title="Sin acceso" body="Tu usuario no tiene permisos de administrador activo." />;
    }

    return (
        <div className="min-h-screen bg-[#fbfaff] text-[#172033]">
            <aside className="fixed left-0 top-0 hidden h-screen w-[244px] border-r border-[#d9d2ff] bg-[linear-gradient(180deg,#f4f0ff_0%,#e9e4ff_48%,#fbfaff_100%)] px-3 py-4 text-[#172033] shadow-[18px_0_55px_rgba(82,63,169,0.13)] xl:block">
                <div className="mb-5 flex justify-center border-b border-[#d9d2ff] px-2 pb-4">
                    <TrackGoLogo size="lg" />
                </div>

                <nav className="space-y-5">
                    <NavSection title="Navegación" items={visibleMainNav} />
                    {visibleSettingsNav.length > 0 ? <NavSection title="Configurar" items={visibleSettingsNav} /> : null}
                </nav>

                <div className="absolute bottom-4 left-3 right-3 space-y-1">
                    <SidebarFooterAction label="Cerrar sesión" icon="logOut" onClick={handleLogout} />

                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#d9d2ff] bg-white/80 px-2 py-2 shadow-sm shadow-violet-200/60">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-[12px] font-bold text-white">
                            C
                        </div>
                        <div className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-[#101936]">
                                {adminLabel}
                            </span>
                            <span className="block text-[10px] font-medium text-[#7c70ba]">
                                {liveDate}
                            </span>
                        </div>
                    </div>
                </div>
            </aside>

            <div className="xl:pl-[228px]">
                <MobileDrawer
                    open={mobileMenuOpen}
                    onClose={() => setMobileMenuOpen(false)}
                    onLogout={handleLogout}
                    adminLabel={adminLabel}
                    liveDate={liveDate}
                    pathname={pathname}
                    navMain={visibleMainNav}
                    navSettings={visibleSettingsNav}
                />

                <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.12),transparent_34%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)] px-3 pb-24 pt-4 text-[#172033] sm:px-5 lg:px-7 xl:bg-none xl:pb-6 xl:pt-5">
                    {children}
                </main>

                <MobileBottomNav pathname={pathname} onLogout={handleLogout} navItems={visibleMobileNav} />
            </div>
        </div>
    );
}

function AdminAccessState({ title, body }: { title: string; body: string }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f5f3ff_0,#f8f7ff_34%,#ffffff_100%)] p-6 text-[#172033]">
            <div className="w-full max-w-sm rounded-2xl border border-[#e8e7fb] bg-white p-6 text-center shadow-[0_24px_70px_rgba(91,33,255,0.12)]">
                <TrackGoLogo variant="mark" size="lg" className="mx-auto mb-4 justify-center" />
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
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7c70ba]">
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
    const pathname = usePathname();
    const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));

    return (
        <Link
            href={href}
            className={[
                "group flex h-9 items-center gap-2 rounded-xl px-2 text-[12px] font-semibold transition",
                active
                    ? "bg-white text-[#4f46e5] shadow-sm"
                    : "text-[#364260] hover:bg-white/85 hover:text-[#4f46e5] hover:shadow-sm",
            ].join(" ")}
        >
            <span
                className={[
                    "flex h-6 w-6 items-center justify-center rounded-lg ring-1 transition",
                    active
                        ? "bg-[#f3f0ff] text-[#5b21ff] ring-[#c8c0ff]"
                        : "bg-white/65 text-[#5b4ea6] ring-[#d9d2ff] group-hover:bg-[#f3f0ff] group-hover:text-[#5b21ff]",
                ].join(" ")}
            >
                <NavIcon name={icon} />
            </span>
            <span>{label}</span>
        </Link>
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

function MobileDrawer({
    open,
    onClose,
    onLogout,
    adminLabel,
    liveDate,
    pathname,
    navMain,
    navSettings,
}: {
    open: boolean;
    onClose: () => void;
    onLogout: () => void;
    adminLabel: string;
    liveDate: string;
    pathname: string;
    navMain: { href: string; label: string; icon: NavIconName }[];
    navSettings: { href: string; label: string; icon: NavIconName }[];
}) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 xl:hidden">
            <button
                type="button"
                className="absolute inset-0 bg-[#101936]/22 backdrop-blur-sm"
                aria-label="Cerrar menú"
                onClick={onClose}
            />

            <aside className="absolute bottom-0 right-0 top-0 flex w-[min(86vw,340px)] flex-col border-l border-[#e4e7ec] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaff_52%,#f3f0ff_100%)] p-4 text-[#172033] shadow-[-24px_0_70px_rgba(82,63,169,0.20)]">
                <div className="mb-4 flex items-center justify-between">
                    <TrackGoLogo size="md" />
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e4e7ec] bg-white text-[20px] leading-none text-[#172033] shadow-sm"
                        aria-label="Cerrar menú"
                    >
                        ×
                    </button>
                </div>

                <nav className="space-y-5">
                    <MobileNavSection title="Navegación" items={navMain} pathname={pathname} onClose={onClose} />
                    {navSettings.length > 0 ? <MobileNavSection title="Configurar" items={navSettings} pathname={pathname} onClose={onClose} /> : null}
                </nav>

                <div className="mt-auto space-y-3">
                    <div className="rounded-2xl border border-[#e4e7ec] bg-white p-3 shadow-sm">
                        <span className="block truncate text-[13px] font-bold text-[#172033]">{adminLabel}</span>
                        <span className="mt-0.5 block text-[11px] font-semibold text-[#667085]">{liveDate}</span>
                    </div>

                    <button
                        type="button"
                        onClick={onLogout}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-[13px] font-bold text-red-600 shadow-sm"
                    >
                        <NavIcon name="logOut" />
                        Cerrar sesión
                    </button>
                </div>
            </aside>
        </div>
    );
}

function MobileNavSection({
    title,
    items,
    pathname,
    onClose,
}: {
    title: string;
    items: { href: string; label: string; icon: NavIconName }[];
    pathname: string;
    onClose: () => void;
}) {
    return (
        <div>
            <p className="mb-2 px-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#7c70ba]">
                {title}
            </p>
            <div className="grid gap-2">
                {items.map((item) => {
                    const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={onClose}
                            className={[
                                "flex h-12 items-center gap-3 rounded-2xl border px-3 text-[13px] font-bold shadow-sm transition",
                                active
                                    ? "border-[#d9d2ff] bg-[#f3f0ff] text-[#4f46e5]"
                                    : "border-[#e4e7ec] bg-white text-[#344054]",
                            ].join(" ")}
                        >
                            <span
                                className={[
                                    "flex h-8 w-8 items-center justify-center rounded-xl ring-1",
                                    active
                                        ? "bg-white text-[#7c3aed] ring-[#d9d2ff]"
                                        : "bg-[#f9fafb] text-[#667085] ring-[#eef1f5]",
                                ].join(" ")}
                            >
                                <NavIcon name={item.icon} />
                            </span>
                            {item.label}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

function isDetailPage(pathname: string) {
    if (pathname.startsWith("/admin/leads/") && pathname !== "/admin/leads/assignments") return true;
    if (pathname.startsWith("/admin/clients/")) return true;
    return false;
}

function MobileBottomNav({ pathname, onLogout, navItems }: { pathname: string; onLogout: () => void; navItems: { href: string; label: string; icon: NavIconName }[] }) {
    const [logoutVisible, setLogoutVisible] = useState(false);
    const touchStartX = useRef(0);

    if (isDetailPage(pathname)) return null;
    if (navItems.length === 0) return null;

    const colsClass = (["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"] as const)[Math.min(navItems.length, 4) - 1] ?? "grid-cols-4";

    function handleTouchStart(e: React.TouchEvent) {
        touchStartX.current = e.touches[0]?.clientX ?? 0;
    }

    function handleTouchEnd(e: React.TouchEvent) {
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        if (dx < -55) setLogoutVisible(true);
        if (dx > 55) setLogoutVisible(false);
    }

    return (
        <nav
            className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#e8e7fb] bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.65rem)] pt-1 shadow-[0_-20px_56px_rgba(82,63,169,0.15)] backdrop-blur-xl xl:hidden"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            <div className="relative mx-auto max-w-md overflow-hidden">
                <div
                    className={[
                        `grid ${colsClass} transition-transform duration-300`,
                        logoutVisible ? "-translate-x-[72px]" : "translate-x-0",
                    ].join(" ")}
                >
                    {navItems.map((item) => {
                        const active = pathname === item.href || pathname.startsWith(item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={[
                                    "relative flex flex-col items-center justify-center gap-0.5 px-1 pb-1 pt-2.5 text-[10px] font-black transition-colors active:opacity-70",
                                    active ? "text-[#4f46e5]" : "text-[#98a2b3]",
                                ].join(" ")}
                            >
                                {active && (
                                    <span className="absolute inset-x-4 top-0 h-[3px] rounded-full bg-gradient-to-r from-[#7c3aed] to-[#4f46e5]" />
                                )}
                                <span
                                    className={[
                                        "flex h-9 w-9 items-center justify-center rounded-[14px] transition-colors",
                                        active ? "bg-[#f3f0ff]" : "",
                                    ].join(" ")}
                                >
                                    <NavIcon name={item.icon} size="md" />
                                </span>
                                <span className="max-w-full truncate leading-none">{item.label}</span>
                            </Link>
                        );
                    })}
                </div>

                {logoutVisible ? (
                    <button
                        type="button"
                        onClick={() => { setLogoutVisible(false); onLogout(); }}
                        className="absolute bottom-0 right-0 top-0 flex w-[68px] flex-col items-center justify-center gap-0.5 bg-red-50 pb-1 pt-2.5 text-[10px] font-black text-red-600 transition active:bg-red-100"
                    >
                        <span className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-red-100">
                            <NavIcon name="logOut" size="md" />
                        </span>
                        <span className="leading-none">Salir</span>
                    </button>
                ) : null}
            </div>
        </nav>
    );
}

function NavIcon({ name, size = "sm" }: { name: NavIconName; size?: "sm" | "md" }) {
    const common = {
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        strokeWidth: 1.8,
    };

    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={size === "md" ? "h-[18px] w-[18px]" : "h-3.5 w-3.5"}>
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

            {name === "more" ? <path {...common} d="M5 12h.01M12 12h.01M19 12h.01" /> : null}
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

            {name === "search" ? <path {...common} d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /> : null}
        </svg>
    );
}