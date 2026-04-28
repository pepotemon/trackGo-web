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
            <span className="text-[11px] font-medium text-[#71717a]">
                {label}
            </span>
            {children}
        </label>
    );
}