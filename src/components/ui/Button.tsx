import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
};

export function Button({
    variant = "secondary",
    className = "",
    children,
    ...props
}: ButtonProps) {
    const variants: Record<ButtonVariant, string> = {
        primary:
            "bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-white border-[#6d28d9] hover:from-[#6d28d9] hover:to-[#4338ca] disabled:opacity-50 shadow-[0_10px_24px_rgba(91,33,255,0.22)]",
        secondary:
            "bg-[#0F172A] text-[#F9FAFB] border-white/[0.08] hover:bg-white/[0.06] disabled:opacity-50 xl:bg-white xl:text-[#344054] xl:border-[#e4e7ec] xl:hover:bg-[#f8f7ff] xl:hover:text-[#4f46e5]",
        danger:
            "bg-red-400/10 text-[#FCA5A5] border-red-400/20 hover:bg-red-400/15 disabled:opacity-50 xl:bg-white xl:text-[#dc2626] xl:border-[#fecaca] xl:hover:bg-[#fef2f2]",
        ghost:
            "bg-transparent text-[#9CA3AF] border-transparent hover:bg-white/[0.06] hover:text-[#F9FAFB] disabled:opacity-50 xl:text-[#667085] xl:hover:bg-[#f2f4f7] xl:hover:text-[#172033]",
    };

    return (
        <button
            className={[
                "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-semibold shadow-sm transition sm:min-h-0 sm:rounded-md",
                variants[variant],
                className,
            ].join(" ")}
            {...props}
        >
            {children}
        </button>
    );
}
