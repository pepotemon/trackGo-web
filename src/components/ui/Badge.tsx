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
        green: "bg-[#ecfdf5] text-[#047857] xl:bg-[#ecfdf5] xl:text-[#047857]",
        red: "bg-[#fef2f2] text-[#dc2626] xl:bg-[#fef2f2] xl:text-[#dc2626]",
        blue: "bg-[#eff6ff] text-[#2563eb] xl:bg-[#eff6ff] xl:text-[#2563eb]",
        gray: "bg-[#f2f4f7] text-[#667085] xl:bg-[#f2f4f7] xl:text-[#667085]",
        yellow: "bg-[#fffbeb] text-[#b45309] xl:bg-[#fffbeb] xl:text-[#b45309]",
        purple: "bg-[#f5f3ff] text-[#7c3aed] xl:bg-[#f5f3ff] xl:text-[#7c3aed]",
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