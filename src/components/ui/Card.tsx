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
                "rounded-2xl border border-[#e7e8f0] bg-white shadow-[0_14px_36px_rgba(16,25,54,0.06)]",
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
        <div className="flex items-start justify-between gap-4 px-4 py-4">
            <div>
                <h2 className="text-[14px] font-bold tracking-[-0.01em] text-[#101936]">
                    {title}
                </h2>
                {subtitle ? (
                    <p className="mt-0.5 text-[12px] font-medium text-[#66739a]">
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
        <div className={["border-t border-[#eef1f5] p-4", className].join(" ")}>
            {children}
        </div>
    );
}
