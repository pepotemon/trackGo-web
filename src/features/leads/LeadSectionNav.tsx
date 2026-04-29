"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
    { href: "/admin/leads", label: "Leads" },
    { href: "/admin/leads/history", label: "Historial" },
    { href: "/admin/leads/assignments", label: "Asignaciones" },
];

export function LeadSectionNav() {
    const pathname = usePathname();

    return (
        <div className="mb-4 inline-flex flex-wrap items-center gap-1 rounded-2xl border border-[#e4e7ec] bg-white p-1 shadow-sm">
            {ITEMS.map((item) => {
                const active = pathname === item.href;

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={
                            active
                                ? "rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] px-4 py-2 text-[12px] font-bold text-white shadow-[0_10px_24px_rgba(91,33,255,0.22)]"
                                : "rounded-xl px-4 py-2 text-[12px] font-bold text-[#66739a] transition hover:bg-[#f8f7ff] hover:text-[#4f46e5]"
                        }
                    >
                        {item.label}
                    </Link>
                );
            })}
        </div>
    );
}
