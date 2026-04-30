import type { InputHTMLAttributes } from "react";

export function Input({
    className = "",
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={[
                "h-10 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-[13px] font-medium text-[#172033] outline-none transition placeholder:text-[#98a2b3] focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100 sm:h-9 sm:rounded-md sm:text-[12px]",
                className,
            ].join(" ")}
            {...props}
        />
    );
}
