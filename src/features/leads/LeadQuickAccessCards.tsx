"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon } from "@/components/ui";

const ACCESS_ITEMS = [
    {
        href: "/admin/leads",
        title: "Leads",
        body: "Cola activa para revisar, validar y asignar leads.",
        icon: "lead",
        tone: "purple",
    },
    {
        href: "/admin/leads/history",
        title: "Historial",
        body: "Leads incompletos o descartados fuera de la cola activa.",
        icon: "history",
        tone: "slate",
    },
    {
        href: "/admin/leads/assignments",
        title: "Asignaciones",
        body: "Auditoria de auto-asignacion y distribucion de trabajo.",
        icon: "assign",
        tone: "green",
    },
] as const;

export function LeadQuickAccessCards() {
    const pathname = usePathname();
    const items = ACCESS_ITEMS.filter((item) => item.href !== pathname);

    return (
        <section className="mb-4 grid gap-2 md:grid-cols-2 md:gap-3">
            {items.map((item) => (
                <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#111827] px-3 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.16)] transition active:bg-[#0F172A] sm:gap-4 sm:px-4 sm:py-4 xl:border-[#e7e8f0] xl:bg-white xl:shadow-[0_16px_42px_rgba(16,25,54,0.06)] xl:hover:border-[#c4b5fd] xl:hover:bg-[#fbfaff]"
                >
                    <AppIcon name={item.icon} tone={item.tone} size="md" className="sm:h-14 sm:w-14" />
                    <div className="min-w-0">
                        <div className="text-[13px] font-black text-[#F9FAFB] sm:text-[14px] xl:font-bold xl:text-[#101936]">{item.title}</div>
                        <div className="mt-0.5 max-w-[360px] text-[11px] font-bold leading-snug text-[#9CA3AF] sm:mt-1 sm:text-[12px] xl:font-medium xl:text-[#66739a]">
                            {item.body}
                        </div>
                    </div>
                    <span className="ml-auto text-[17px] font-bold text-[#93C5FD] transition group-hover:translate-x-0.5 xl:text-[#a78bfa]">
                        {">"}
                    </span>
                </Link>
            ))}
        </section>
    );
}
