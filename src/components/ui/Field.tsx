import type { ReactNode } from "react";

export function Field({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <label className="grid gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#667085] xl:font-semibold xl:text-[#667085]">
                {label}
            </span>
            {children}
        </label>
    );
}