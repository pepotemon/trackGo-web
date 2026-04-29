import type { InputHTMLAttributes } from "react";

export function Input({
    className = "",
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={[
                "h-9 w-full rounded-md border border-[#d0d5dd] bg-white px-3 text-[12px] font-medium text-[#172033] outline-none transition placeholder:text-[#98a2b3] focus:border-[#2563eb] focus:ring-2 focus:ring-blue-100",
                className,
            ].join(" ")}
            {...props}
        />
    );
}
