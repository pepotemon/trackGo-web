import Link from "next/link";

const NAV_MAIN = [
    { href: "/admin", label: "Dashboard", icon: "D" },
    { href: "/admin/leads", label: "Leads", icon: "L" },
    { href: "/admin/leads/history", label: "Historial", icon: "H" },
    { href: "/admin/leads/assignments", label: "Asignaciones", icon: "A" },
    { href: "/admin/activity", label: "Actividad", icon: "O" },
    { href: "/admin/accounting", label: "Contabilidad", icon: "▣" },
];

const NAV_SETTINGS = [
    { href: "/admin/settings/users", label: "Usuarios", icon: "◈" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-[#f4f5f6] text-[#171717]">
            <aside className="fixed left-0 top-0 hidden h-screen w-[232px] border-r border-[#e5e7eb] bg-[#f7f8f9] px-4 py-4 xl:block">
                <div className="mb-5 flex items-center gap-2 px-1">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-black text-[11px] font-bold text-white">
                        T
                    </div>

                    <div className="min-w-0">
                        <div className="flex items-center gap-1">
                            <p className="truncate text-[14px] font-semibold leading-none text-[#171717]">
                                TrackGo
                            </p>
                            <span className="text-[11px] text-[#9ca3af]">⌄</span>
                        </div>
                    </div>
                </div>

                <div className="mb-4">
                    <div className="flex h-8 items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white px-2 text-[#9ca3af] shadow-sm">
                        <span className="text-[12px]">⌕</span>
                        <span className="text-[12px] font-medium">Search</span>
                        <span className="ml-auto rounded border border-[#e5e7eb] px-1.5 py-0.5 text-[10px] text-[#9ca3af]">
                            ⌘ K
                        </span>
                    </div>
                </div>

                <nav className="space-y-5">
                    <NavSection title="Analytics" items={NAV_MAIN} />

                    <NavSection title="Settings" items={NAV_SETTINGS} />
                </nav>

                <div className="absolute bottom-4 left-4 right-4 space-y-1">
                    <SidebarFooterLink label="Support" icon="●" />
                    <SidebarFooterLink label="What's New?" icon="◐" />

                    <div className="mt-3 flex items-center gap-2 rounded-lg px-2 py-2">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">
                            C
                        </div>
                        <span className="text-[12px] font-semibold text-[#171717]">
                            Admin
                        </span>
                    </div>
                </div>
            </aside>

            <div className="xl:pl-[232px]">
                <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#e5e7eb] bg-white/90 px-4 backdrop-blur-xl xl:hidden">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-black text-[11px] font-bold text-white">
                            T
                        </div>
                        <p className="text-[14px] font-semibold">TrackGo</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <MobileLink href="/admin" label="Dash" />
                        <MobileLink href="/admin/leads" label="Leads" />
                        <MobileLink href="/admin/leads/history" label="Hist." />
                        <MobileLink href="/admin/leads/assignments" label="Asig." />
                        <MobileLink href="/admin/activity" label="Act." />
                        <MobileLink href="/admin/accounting" label="Conta." />
                        <MobileLink href="/admin/settings/users" label="Usuarios" />
                    </div>
                </div>

                <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-7">
                    {children}
                </main>
            </div>
        </div>
    );
}

function NavSection({
    title,
    items,
}: {
    title: string;
    items: { href: string; label: string; icon: string }[];
}) {
    return (
        <div>
            <p className="mb-1.5 px-2 text-[11px] font-medium text-[#9ca3af]">
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
    icon: string;
}) {
    return (
        <Link
            href={href}
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] font-semibold text-[#52525b] transition hover:bg-white hover:text-[#171717] hover:shadow-sm"
        >
            <span className="flex h-4 w-4 items-center justify-center text-[11px] text-[#71717a]">
                {icon}
            </span>
            <span>{label}</span>
        </Link>
    );
}

function SidebarFooterLink({ label, icon }: { label: string; icon: string }) {
    return (
        <button className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-[#71717a] transition hover:bg-white hover:text-[#171717]">
            <span className="text-[10px]">{icon}</span>
            <span>{label}</span>
        </button>
    );
}

function MobileLink({ href, label }: { href: string; label: string }) {
    return (
        <Link
            href={href}
            className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#52525b] shadow-sm"
        >
            {label}
        </Link>
    );
}
