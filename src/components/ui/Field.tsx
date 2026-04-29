import type { ReactNode } from "react";

export function Field({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <label className="grid gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#667085]">
                {label}
            </span>
            {children}
        </label>
    );
}
