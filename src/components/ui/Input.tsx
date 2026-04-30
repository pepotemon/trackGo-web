import type { InputHTMLAttributes } from "react";

export function Input({
    className = "",
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={[
                "h-10 w-full rounded-[15px] border border-white/[0.08] bg-[#0F172A] px-3 text-[13px] font-bold text-[#F9FAFB] outline-none transition placeholder:text-[#9CA3AF] focus:border-blue-400/35 focus:ring-2 focus:ring-blue-400/10 sm:h-9 sm:rounded-md sm:text-[12px] xl:border-[#d0d5dd] xl:bg-white xl:font-medium xl:text-[#172033] xl:placeholder:text-[#98a2b3] xl:focus:border-[#7c3aed] xl:focus:ring-violet-100",
                className,
            ].join(" ")}
            {...props}
        />
    );
}
