import type { ReactNode } from "react";

export function Card({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                "rounded-[22px] border border-[#e8e3ff] bg-white shadow-[0_14px_34px_rgba(91,33,255,0.08)] xl:rounded-2xl xl:border-[#e7e8f0] xl:bg-white xl:shadow-[0_14px_36px_rgba(16,25,54,0.06)]",
                className,
            ].join(" ")}
        >
            {children}
        </div>
    );
}

export function CardHeader({
    title,
    subtitle,
    action,
}: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex items-start justify-between gap-4 px-3 py-3 sm:px-4 sm:py-4">
            <div className="min-w-0">
                <h2 className="truncate text-[14px] font-black tracking-[-0.01em] text-[#101936] xl:font-bold xl:text-[#101936]">
                    {title}
                </h2>
                {subtitle ? (
                    <p className="mt-0.5 text-[12px] font-semibold text-[#66739a] xl:font-medium xl:text-[#66739a]">
                        {subtitle}
                    </p>
                ) : null}
            </div>

            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

export function CardContent({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={["border-t border-[#f0edff] p-3 sm:p-4 xl:border-[#eef1f5]", className].join(" ")}>
            {children}
        </div>
    );
}