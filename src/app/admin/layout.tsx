"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";

type NavIconName =
    | "activity"
    | "dashboard"
    | "inbox"
    | "search"
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
    const pathname = usePathname();
    const { firebaseUser, isAdmin, loading, logout } = useAuth();
    const [sidebarSearch, setSidebarSearch] = useState("");
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

    async function handleLogout() {
        await logout();
        router.replace("/login");
    }

    function handleSidebarSearch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const query = sidebarSearch.trim();
        setMobileMenuOpen(false);
        router.push(query ? `/admin/leads?search=${encodeURIComponent(query)}` : "/admin/leads");
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
        return <AdminAccessState title="Validando acceso" body="Estamos revisando tu sesion administrativa." />;
    }

    if (!firebaseUser) {
        return <AdminAccessState title="Redirigiendo" body="Necesitas iniciar sesion para entrar al panel." />;
    }

    if (!isAdmin) {
        return <AdminAccessState title="Sin acceso" body="Tu usuario no tiene permisos de administrador activo." />;
    }

    return (
        <div className="min-h-screen bg-[#0B1220] text-[#F9FAFB] xl:bg-[linear-gradient(180deg,#fbfaff_0%,#f7f8ff_48%,#f3f0ff_100%)] xl:text-[#101936]">
            <aside className="fixed left-0 top-0 hidden h-screen w-[244px] border-r border-[#c8c0ff] bg-[linear-gradient(180deg,#eee8ff_0%,#ddd5ff_46%,#f2f0ff_100%)] px-3 py-4 text-[#172033] shadow-[18px_0_55px_rgba(82,63,169,0.15)] xl:block">
                <div className="mb-5 flex justify-center border-b border-[#c8c0ff] px-2 pb-4">
                    <TrackGoLogo size="lg" />
                </div>

                <form className="mb-4" onSubmit={handleSidebarSearch}>
                    <label className="flex h-9 items-center gap-2 rounded-xl border border-[#c8c0ff] bg-white/62 px-2 text-[#5b4ea6] shadow-sm shadow-violet-200/70">
                        <NavIcon name="search" />
                        <input
                            value={sidebarSearch}
                            onChange={(event) => setSidebarSearch(event.target.value)}
                            placeholder="Buscar lead..."
                            className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-[#364260] outline-none placeholder:text-[#7c70ba]"
                        />
                        <button
                            type="submit"
                            className="rounded border border-[#e4e7ec] bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#6d5fb4]"
                            aria-label="Buscar en leads"
                            title="Buscar en leads"
                        >
                            Ir
                        </button>
                    </label>
                </form>

                <nav className="space-y-5">
                    <NavSection title="Navegacion" items={NAV_MAIN} />
                    <NavSection title="Configurar" items={NAV_SETTINGS} />
                </nav>

                <div className="absolute bottom-4 left-3 right-3 space-y-1">
                    <SidebarFooterAction label="Cerrar sesion" icon="logOut" onClick={handleLogout} />

                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#c8c0ff] bg-white/62 px-2 py-2 shadow-sm shadow-violet-200/70">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-[12px] font-bold text-white">
                            C
                        </div>
                        <div>
                            <span className="block text-[12px] font-semibold text-[#101936]">
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
                <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#0B1220]/92 px-3 backdrop-blur-xl xl:hidden">
                    <div className="flex items-center gap-2">
                        <TrackGoLogo size="sm" />
                    </div>

                    <div className="flex items-center gap-2">
                        <form className="hidden min-w-0 flex-1 sm:block" onSubmit={handleSidebarSearch}>
                            <label className="flex h-9 w-[260px] items-center gap-2 rounded-full border border-white/[0.08] bg-[#0F172A] px-3 text-[#9CA3AF] shadow-sm">
                                <NavIcon name="search" />
                                <input
                                    value={sidebarSearch}
                                    onChange={(event) => setSidebarSearch(event.target.value)}
                                    placeholder="Buscar lead..."
                                    className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-[#F9FAFB] outline-none placeholder:text-[#9CA3AF]"
                                />
                            </label>
                        </form>
                        <button
                            type="button"
                            onClick={() => setMobileMenuOpen(true)}
                            className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-white/[0.08] bg-[#0F172A] text-[#F9FAFB] shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                            aria-label="Abrir menu"
                            title="Menu"
                        >
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
                                <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                            </svg>
                        </button>
                    </div>
                </div>

                <MobileDrawer
                    open={mobileMenuOpen}
                    onClose={() => setMobileMenuOpen(false)}
                    onLogout={handleLogout}
                    onSearch={handleSidebarSearch}
                    search={sidebarSearch}
                    setSearch={setSidebarSearch}
                    adminLabel={adminLabel}
                    liveDate={liveDate}
                    pathname={pathname}
                />

                <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.22),_transparent_32%),linear-gradient(180deg,#0B1220_0%,#0B1220_55%,#111827_100%)] px-3 pb-24 pt-4 sm:px-5 lg:px-7 xl:bg-none xl:pb-6 xl:pt-5">
                    {children}
                </main>

                <MobileBottomNav pathname={pathname} />
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
    return (
        <Link
            href={href}
            className="group flex h-9 items-center gap-2 rounded-xl px-2 text-[12px] font-semibold text-[#364260] transition hover:bg-white/85 hover:text-[#4f46e5] hover:shadow-sm"
        >
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/65 text-[#5b4ea6] ring-1 ring-[#c8c0ff] transition group-hover:bg-[#f3f0ff] group-hover:text-[#5b21ff]">
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
    onSearch,
    search,
    setSearch,
    adminLabel,
    liveDate,
    pathname,
}: {
    open: boolean;
    onClose: () => void;
    onLogout: () => void;
    onSearch: (event: FormEvent<HTMLFormElement>) => void;
    search: string;
    setSearch: (value: string) => void;
    adminLabel: string;
    liveDate: string;
    pathname: string;
}) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 xl:hidden">
            <button
                type="button"
                className="absolute inset-0 bg-[#101936]/35 backdrop-blur-sm"
                aria-label="Cerrar menu"
                onClick={onClose}
            />

            <aside className="absolute bottom-0 right-0 top-0 flex w-[min(86vw,340px)] flex-col border-l border-white/[0.08] bg-[linear-gradient(180deg,#0B1220_0%,#111827_48%,#0F172A_100%)] p-4 text-[#F9FAFB] shadow-[-24px_0_70px_rgba(0,0,0,0.36)]">
                <div className="mb-4 flex items-center justify-between">
                    <TrackGoLogo size="md" />
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[20px] leading-none text-[#F9FAFB] shadow-sm"
                        aria-label="Cerrar menu"
                    >
                        x
                    </button>
                </div>

                <form className="mb-5" onSubmit={onSearch}>
                    <label className="flex h-11 items-center gap-2 rounded-2xl border border-white/[0.08] bg-[#0F172A] px-3 text-[#9CA3AF] shadow-sm">
                        <NavIcon name="search" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar lead, telefono..."
                            className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[#F9FAFB] outline-none placeholder:text-[#9CA3AF]"
                        />
                    </label>
                </form>

                <nav className="space-y-5">
                    <MobileNavSection title="Navegacion" items={NAV_MAIN} pathname={pathname} onClose={onClose} />
                    <MobileNavSection title="Configurar" items={NAV_SETTINGS} pathname={pathname} onClose={onClose} />
                </nav>

                <div className="mt-auto space-y-3">
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 shadow-sm">
                        <span className="block truncate text-[13px] font-bold text-[#F9FAFB]">{adminLabel}</span>
                        <span className="mt-0.5 block text-[11px] font-semibold text-[#9CA3AF]">{liveDate}</span>
                    </div>

                    <button
                        type="button"
                        onClick={onLogout}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-400/10 text-[13px] font-bold text-[#FCA5A5] shadow-sm"
                    >
                        <NavIcon name="logOut" />
                        Cerrar sesion
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
                                    ? "border-white/18 bg-blue-500/16 text-[#F9FAFB]"
                                    : "border-white/[0.08] bg-white/[0.04] text-[#CBD5E1]",
                            ].join(" ")}
                        >
                            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0F172A] text-[#93C5FD] ring-1 ring-white/[0.08]">
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

function MobileBottomNav({ pathname }: { pathname: string }) {
    return (
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.06] bg-[#0B1220]/92 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-18px_45px_rgba(0,0,0,0.24)] backdrop-blur-xl xl:hidden">
            <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
                {NAV_MAIN.map((item) => {
                    const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={[
                                "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-bold transition",
                                active ? "bg-white/[0.06] text-[#F9FAFB]" : "text-[#9CA3AF]",
                            ].join(" ")}
                        >
                            <span className={active ? "text-[#93C5FD]" : "text-[#9CA3AF]"}>
                                <NavIcon name={item.icon} />
                            </span>
                            <span className="max-w-full truncate">{item.label === "Contabilidad" ? "Conta" : item.label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
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
            {name === "search" ? <path {...common} d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /> : null}
        </svg>
    );
}
