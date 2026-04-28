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
            "bg-black text-white border-black hover:bg-[#27272a] disabled:opacity-60",
        secondary:
            "bg-white text-[#52525b] border-[#e5e7eb] hover:bg-[#f9fafb] disabled:opacity-60",
        danger:
            "bg-white text-red-500 border-red-200 hover:bg-red-50 disabled:opacity-60",
        ghost:
            "bg-transparent text-[#71717a] border-transparent hover:bg-[#f4f5f6] disabled:opacity-60",
    };

    return (
        <button
            className={[
                "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-[12px] font-semibold shadow-sm transition",
                variants[variant],
                className,
            ].join(" ")}
            {...props}
        >
            {children}
        </button>
    );
}