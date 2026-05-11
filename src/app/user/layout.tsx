"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { TrackGoLogo } from "@/components/brand/TrackGoLogo";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { ResumeRefresh } from "@/components/mobile/ResumeRefresh";
import { VendorPushPrompt } from "@/components/mobile/VendorPushPrompt";

type NavIconName = "leads" | "database" | "map" | "history" | "chat" | "settings" | "logOut";
type VendorNavPermission = "canSeeMap" | "canSeeHistory" | "canSeeChat" | "canSeeSubscriptions" | "canSeeCommercialDirectory";

const BASE_NAV: { href: string; label: string; icon: NavIconName; permKey?: VendorNavPermission }[] = [
    { href: "/user/leads", label: "Prospectos", icon: "leads" },
    { href: "/user/commercial-directory", label: "Base", icon: "database", permKey: "canSeeCommercialDirectory" },
    { href: "/user/map", label: "Mapa", icon: "map", permKey: "canSeeMap" },
    { href: "/user/history", label: "Historial", icon: "history", permKey: "canSeeHistory" },
    { href: "/user/chat", label: "Recup.", icon: "chat", permKey: "canSeeChat" },
    { href: "/user/settings", label: "Config.", icon: "settings" },
];

export default function UserLayout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { firebaseUser, profile, isUser, loading, logout, userPermissions } = useAuth();
    const MOBILE_NAV = BASE_NAV.filter((item) =>
        !item.permKey || userPermissions[item.permKey]
    );

    useEffect(() => {
        if (loading) return;
        if (!firebaseUser) { router.replace("/login"); return; }
        if (!isUser) { router.replace(profile?.role === "admin" ? "/admin" : "/no-access"); }
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
    const userInitial = userName.slice(0, 1).toUpperCase();

    const colsClass = (["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5", "grid-cols-6"] as const)[Math.min(MOBILE_NAV.length, 6) - 1] ?? "grid-cols-5";

    return (
        <div className="min-h-screen bg-[#fbfaff] text-[#172033]">
            <ResumeRefresh />
            <PullToRefresh disabled={pathname.startsWith("/user/map") || pathname.startsWith("/user/chat")} />
            <VendorPushPrompt userId={firebaseUser.uid} />
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
                                        : "bg-white/65 text-[#5b4ea6] ring-[#d9d2ff]",
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
                            {userInitial}
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
                    <div className="mx-auto max-w-md">
                        <div className={`grid ${colsClass}`}>
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
            {name === "database" ? (
                <>
                    <ellipse {...common} cx="12" cy="5" rx="7" ry="3" />
                    <path {...common} d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
                    <path {...common} d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
                </>
            ) : null}
            {name === "history" ? (
                <>
                    <path {...common} d="M12 7v5l3 2" />
                    <path {...common} d="M3.05 11a9 9 0 1 1 .5 4M3 15v-4h4" />
                </>
            ) : null}
            {name === "chat" ? (
                <>
                    <path {...common} d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </>
            ) : null}
            {name === "logOut" ? (
                <>
                    <path {...common} d="M10 17l5-5-5-5" />
                    <path {...common} d="M15 12H3" />
                    <path {...common} d="M21 19V5a2 2 0 0 0-2-2h-6" />
                </>
            ) : null}
            {name === "settings" ? (
                <>
                    <circle {...common} cx="12" cy="12" r="3" />
                    <path {...common} d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 0 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
                </>
            ) : null}
        </svg>
    );
}
