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
                "rounded-xl border border-[#e5e7eb] bg-white shadow-sm",
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
                <h2 className="text-[14px] font-semibold text-[#171717]">
                    {title}
                </h2>
                {subtitle ? (
                    <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
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
        <div className={["border-t border-[#f0f1f2] p-4", className].join(" ")}>
            {children}
        </div>
    );
}