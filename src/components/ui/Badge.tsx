import type { ReactNode } from "react";

type BadgeTone = "green" | "red" | "blue" | "gray" | "yellow" | "purple";

export function Badge({
    children,
    tone = "gray",
}: {
    children: ReactNode;
    tone?: BadgeTone;
}) {
    const map: Record<BadgeTone, string> = {
        green: "bg-emerald-400/10 text-[#86EFAC] xl:bg-[#ecfdf5] xl:text-[#047857]",
        red: "bg-red-400/10 text-[#FCA5A5] xl:bg-[#fef2f2] xl:text-[#dc2626]",
        blue: "bg-blue-400/10 text-[#93C5FD] xl:bg-[#eff6ff] xl:text-[#2563eb]",
        gray: "bg-white/[0.06] text-[#CBD5E1] xl:bg-[#f2f4f7] xl:text-[#667085]",
        yellow: "bg-yellow-300/10 text-[#FDE68A] xl:bg-[#fffbeb] xl:text-[#b45309]",
        purple: "bg-violet-400/10 text-[#C4B5FD] xl:bg-[#f5f3ff] xl:text-[#7c3aed]",
    };

    return (
        <span
            className={[
                "inline-flex items-center justify-center",
                "rounded-[6px]",
                "px-2 py-[3px]",
                "text-[10px] font-semibold uppercase tracking-[0.04em]",
                map[tone],
            ].join(" ")}
        >
            {children}
        </span>
    );
}