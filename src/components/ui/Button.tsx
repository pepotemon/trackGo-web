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
            "bg-white text-[#344054] border-[#e4e7ec] hover:bg-[#f8f7ff] hover:text-[#4f46e5] disabled:opacity-50",
        danger:
            "bg-white text-[#dc2626] border-[#fecaca] hover:bg-[#fef2f2] disabled:opacity-50",
        ghost:
            "bg-transparent text-[#667085] border-transparent hover:bg-[#f2f4f7] hover:text-[#172033] disabled:opacity-50",
    };

    return (
        <button
            className={[
                "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-[12px] font-semibold shadow-sm transition",
                variants[variant],
                className,
            ].join(" ")}
            {...props}
        >
            {children}
        </button>
    );
}
