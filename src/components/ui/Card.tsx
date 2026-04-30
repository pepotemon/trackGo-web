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
                "rounded-[18px] border border-white/[0.08] bg-[#111827] shadow-[0_14px_36px_rgba(0,0,0,0.18)] xl:rounded-2xl xl:border-[#e7e8f0] xl:bg-white xl:shadow-[0_14px_36px_rgba(16,25,54,0.06)]",
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
            <div>
                <h2 className="text-[14px] font-black tracking-[-0.01em] text-[#F9FAFB] xl:font-bold xl:text-[#101936]">
                    {title}
                </h2>
                {subtitle ? (
                    <p className="mt-0.5 text-[12px] font-extrabold text-[#9CA3AF] xl:font-medium xl:text-[#66739a]">
                        {subtitle}
                    </p>
                ) : null}
            </div>

            {action ? <div>{action}</div> : null}
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
        <div className={["border-t border-white/[0.08] p-3 sm:p-4 xl:border-[#eef1f5]", className].join(" ")}>
            {children}
        </div>
    );
}
