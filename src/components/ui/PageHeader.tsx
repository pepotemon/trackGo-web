import type { ReactNode } from "react";

export function PageHeader({
    title,
    subtitle,
    icon,
    tabs,
    actions,
}: {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    tabs?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="mb-3 flex flex-col gap-3 rounded-none border-0 bg-transparent px-1 py-1 shadow-none backdrop-blur-xl sm:px-4 sm:py-4 lg:mb-5 lg:flex-row lg:items-start lg:justify-between xl:rounded-2xl xl:border xl:border-[#e8e7fb] xl:bg-white/88 xl:px-4 xl:py-4 xl:shadow-[0_14px_34px_rgba(36,30,86,0.07)]">
            <div>
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#e8e7fb] bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-white shadow-[0_10px_26px_rgba(91,33,255,0.22)] sm:h-11 sm:w-11 xl:border-0 xl:bg-gradient-to-br xl:from-[#7c3aed] xl:via-[#5b21ff] xl:to-[#2563eb] xl:shadow-[0_12px_30px_rgba(91,33,255,0.24)]">
                        {icon ?? <span className="text-[15px] font-bold">T</span>}
                    </div>

                    <div className="min-w-0">
                        <h1 className="truncate text-[19px] font-black tracking-[-0.035em] text-[#101936] sm:text-[24px] xl:text-[#101936]">
                            {title}
                        </h1>

                        {subtitle ? (
                            <p className="mt-0.5 text-[12px] font-semibold leading-snug text-[#66739a] sm:mt-1 sm:text-[13px] xl:font-medium xl:text-[#66739a]">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>
                </div>

                {tabs ? (
                    <div className="mt-4 inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-[#e8e7fb] bg-[#f8f7ff] p-1 shadow-sm lg:mt-5 xl:border-[#e4e7ec] xl:bg-[#f8f7ff]">
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
                    ? "rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-[#5b21ff] shadow-sm"
                    : "rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[#66739a] transition hover:bg-[#f3f0ff] hover:text-[#101936]"
            }
        >
            {children}
        </button>
    );
}