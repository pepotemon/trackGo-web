import type { ReactNode } from "react";

export function PageHeader({
    title,
    tabs,
    actions,
}: {
    title: string;
    tabs?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="mb-4 flex flex-col gap-4 border-b border-[#e5e7eb] bg-white pb-4 pt-1 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-black text-[11px] font-bold text-white">
                        T
                    </div>
                    <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#171717]">
                        {title}
                    </h1>
                </div>

                {tabs ? (
                    <div className="mt-5 inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#e5e7eb] bg-[#f4f5f6] p-1">
                        {tabs}
                    </div>
                ) : null}
            </div>

            {actions ? (
                <div className="flex flex-wrap items-center gap-2">{actions}</div>
            ) : null}
        </header>
    );
}

export function PageTab({
    children,
    active,
    onClick,
}: {
    children: ReactNode;
    active?: boolean;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                active
                    ? "rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-[#171717] shadow-sm"
                    : "rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[#71717a] transition hover:bg-white/70 hover:text-[#171717]"
            }
        >
            {children}
        </button>
    );
}