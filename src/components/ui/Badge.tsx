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
        green: "bg-emerald-50 text-emerald-600",
        red: "bg-red-50 text-red-500",
        blue: "bg-blue-50 text-blue-600",
        gray: "bg-[#f4f5f6] text-[#71717a]",
        yellow: "bg-yellow-50 text-yellow-700",
        purple: "bg-violet-50 text-violet-600",
    };

    return (
        <span
            className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${map[tone]}`}
        >
            {children}
        </span>
    );
}