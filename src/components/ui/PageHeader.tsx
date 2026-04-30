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
        <header className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#e8e7fb] bg-white/88 px-3 py-3 shadow-[0_14px_34px_rgba(36,30,86,0.07)] backdrop-blur-xl sm:px-4 sm:py-4 lg:mb-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c3aed] via-[#5b21ff] to-[#2563eb] text-white shadow-[0_12px_30px_rgba(91,33,255,0.24)] sm:h-11 sm:w-11">
                        {icon ?? <span className="text-[15px] font-bold">T</span>}
                    </div>
                    <div>
                        <h1 className="text-[20px] font-bold tracking-[-0.035em] text-[#101936] sm:text-[24px]">
                            {title}
                        </h1>
                        {subtitle ? (
                            <p className="mt-0.5 text-[12px] font-medium leading-snug text-[#66739a] sm:mt-1 sm:text-[13px]">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>
                </div>

                {tabs ? (
                    <div className="mt-4 inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-[#e4e7ec] bg-[#f8f7ff] p-1 shadow-sm lg:mt-5">
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
                    : "rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[#66739a] transition hover:bg-white/70 hover:text-[#101936]"
            }
        >
            {children}
        </button>
    );
}
