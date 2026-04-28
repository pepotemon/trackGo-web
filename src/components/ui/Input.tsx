import type { InputHTMLAttributes } from "react";

export function Input({
    className = "",
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={[
                "h-9 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-medium text-[#171717] outline-none transition placeholder:text-[#c4c4c4] focus:border-[#171717]",
                className,
            ].join(" ")}
            {...props}
        />
    );
}