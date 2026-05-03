"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";

type NavIconName = "leads" | "map" | "history" | "logOut";

const MOBILE_NAV: { href: string; label: string; icon: NavIconName }[] = [
    { href: "/user/leads", label: "Prospectos", icon: "leads" },
    { href: "/user/map", label: "Mapa", icon: "map" },
    { href: "/user/history", label: "Historial", icon: "history" },
];

export default function UserLayout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { firebaseUser, profile, isUser, loading, logout } = useAuth();

    useEffect(() => {
        if (loading) return;
        if (!firebaseUser) { router.replace("/login"); return; }
        if (!isUser) { router.replace(profile?.role === "admin" ? "/admin/accounting" : "/no-access"); }
    }, [firebaseUser, isUser, loading, profile, router]);

    async function handleLogout() {
        await logout();
        router.replace("/login");
    }

    if (loading) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f5f3ff_0,#f8f7ff_34%,#ffffff_100%)] p-6">
                <div className="w-full max-w-sm rounded-2xl border border-[#e8e7fb] bg-white p-6 text-center shadow-[0_24px_70px_rgba(91,33,255,0.12)]">
                    <TrackGoLogo variant="mark" size="lg" className="mx-auto mb-4 justify-center" />
                    <p className="text-[13px] font-semibold text-[#667085]">Verificando sesión...</p>
                </div>
            </main>
        );
    }

    if (!firebaseUser || !isUser) return null;

    const userName = profile?.name?.split(" ")[0] ?? "Vendedor";

    return (
        <div className="min-h-screen bg-[#fbfaff] text-[#172033]">
            {/* ── DESKTOP SIDEBAR ─────────────────────────────────────── */}
            <aside className="fixed left-0 top-0 hidden h-screen w-[220px] flex-col border-r border-[#d9d2ff] bg-[linear-gradient(180deg,#f4f0ff_0%,#e9e4ff_48%,#fbfaff_100%)] px-3 py-4 shadow-[18px_0_55px_rgba(82,63,169,0.13)] xl:flex">
                <div className="mb-5 flex justify-center border-b border-[#d9d2ff] px-2 pb-4">
                    <TrackGoLogo size="lg" />
                </div>

                <nav className="flex-1 space-y-0.5">
                    {MOBILE_NAV.map((item) => {
                        const active = pathname === item.href || pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={[
                                    "flex h-9 items-center gap-2 rounded-xl px-2 text-[12px] font-semibold transition",
                                    active
                                        ? "bg-white text-[#4f46e5] shadow-sm"
                                        : "text-[#364260] hover:bg-white/85 hover:text-[#4f46e5] hover:shadow-sm",
                                ].join(" ")}
                            >
                                <span className={[
                                    "flex h-6 w-6 items-center justify-center rounded-lg ring-1 transition",
                                    active
                                        ? "bg-[#f3f0ff] text-[#5b21ff] ring-[#c8c0ff]"
                                        : "bg-white/65 text-[#5b4ea6] ring-[#d9d2ff] group-hover:bg-[#f3f0ff]",
                                ].join(" ")}>
                                    <NavIcon name={item.icon} />
                                </span>
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="space-y-1">
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-[#dc2626] transition hover:bg-[#fef2f2]"
                    >
                        <span className="flex h-5 w-5 items-center justify-center">
                            <NavIcon name="logOut" />
                        </span>
                        Cerrar sesión
                    </button>
                    <div className="flex items-center gap-2 rounded-xl border border-[#d9d2ff] bg-white/80 px-2 py-2 shadow-sm">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-[11px] font-bold text-white">
                            {userName.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="truncate text-[12px] font-semibold text-[#101936]">{userName}</span>
                    </div>
                </div>
            </aside>

            {/* ── MAIN CONTENT ────────────────────────────────────────── */}
            <div className="xl:pl-[220px]">
                <main className="min-h-screen pb-[72px] xl:pb-0">
                    {children}
                </main>

                {/* ── MOBILE BOTTOM NAV ───────────────────────────────── */}
                <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#e8e7fb] bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.65rem)] pt-1 shadow-[0_-20px_56px_rgba(82,63,169,0.15)] backdrop-blur-xl xl:hidden">
                    <div className="mx-auto grid max-w-md grid-cols-3">
                        {MOBILE_NAV.map((item) => {
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
                                    <span className={[
                                        "flex h-9 w-9 items-center justify-center rounded-[14px] transition-colors",
                                        active ? "bg-[#f3f0ff]" : "",
                                    ].join(" ")}>
                                        <NavIcon name={item.icon} size="md" />
                                    </span>
                                    <span className="max-w-full truncate leading-none">{item.label}</span>
                                </Link>
                            );
                        })}
                    </div>
                </nav>
            </div>
        </div>
    );
}

function NavIcon({ name, size = "sm" }: { name: NavIconName; size?: "sm" | "md" }) {
    const s = size === "md" ? "h-[18px] w-[18px]" : "h-3.5 w-3.5";
    const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={s}>
            {name === "leads" ? (
                <>
                    <path {...common} d="M4 4h16l-2 9H6L4 4Z" />
                    <path {...common} d="M6 13v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" />
                    <path {...common} d="M9 16h6" />
                </>
            ) : null}
            {name === "map" ? (
                <>
                    <path {...common} d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
                    <path {...common} d="M9 3v15M15 6v15" />
                </>
            ) : null}
            {name === "history" ? (
                <>
                    <path {...common} d="M12 7v5l3 2" />
                    <path {...common} d="M3.05 11a9 9 0 1 1 .5 4M3 15v-4h4" />
                </>
            ) : null}
            {name === "logOut" ? (
                <>
                    <path {...common} d="M10 17l5-5-5-5" />
                    <path {...common} d="M15 12H3" />
                    <path {...common} d="M21 19V5a2 2 0 0 0-2-2h-6" />
                </>
            ) : null}
        </svg>
    );
}
