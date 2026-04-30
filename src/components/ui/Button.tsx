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
            "border-[#6d28d9] bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-white shadow-[0_12px_26px_rgba(91,33,255,0.24)] active:scale-[0.98] hover:from-[#6d28d9] hover:to-[#4338ca] disabled:opacity-50",
        secondary:
            "border-[#ded8ff] bg-white text-[#312e81] shadow-[0_8px_22px_rgba(91,33,255,0.08)] active:scale-[0.98] hover:bg-[#f8f7ff] disabled:opacity-50 xl:border-[#e4e7ec] xl:bg-white xl:text-[#344054] xl:hover:bg-[#f8f7ff] xl:hover:text-[#4f46e5]",
        danger:
            "border-red-200 bg-red-50 text-red-600 shadow-[0_8px_22px_rgba(220,38,38,0.08)] active:scale-[0.98] hover:bg-red-100 disabled:opacity-50 xl:bg-white xl:text-[#dc2626] xl:border-[#fecaca] xl:hover:bg-[#fef2f2]",
        ghost:
            "border-transparent bg-transparent text-[#6b7280] active:scale-[0.98] hover:bg-[#f3f0ff] hover:text-[#4f46e5] disabled:opacity-50 xl:text-[#667085] xl:hover:bg-[#f2f4f7] xl:hover:text-[#172033]",
    };

    return (
        <button
            className={[
                "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[14px] border px-3 py-2 text-[12px] font-bold shadow-sm transition disabled:cursor-not-allowed sm:min-h-0 sm:rounded-md",
                variants[variant],
                className,
            ].join(" ")}
            {...props}
        >
            {children}
        </button>
    );
}