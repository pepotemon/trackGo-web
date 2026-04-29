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
        <header className="mb-4 flex flex-col gap-4 border-b border-[#e4e7ec] bg-[#f6f8fb] pb-4 pt-1 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[#2563eb] text-[11px] font-bold text-white">
                        T
                    </div>
                    <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#172033]">
                        {title}
                    </h1>
                </div>

                {tabs ? (
                    <div className="mt-5 inline-flex flex-wrap items-center gap-1 rounded-lg border border-[#e4e7ec] bg-white p-1 shadow-sm">
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
                    ? "rounded-md bg-[#eff6ff] px-3 py-1.5 text-[12px] font-semibold text-[#2563eb] shadow-sm"
                    : "rounded-md px-3 py-1.5 text-[12px] font-semibold text-[#667085] transition hover:bg-[#f2f4f7] hover:text-[#172033]"
            }
        >
            {children}
        </button>
    );
}
