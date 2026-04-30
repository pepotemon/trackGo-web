import type { InputHTMLAttributes } from "react";

export function Input({
    className = "",
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={[
                "h-10 w-full rounded-[14px]",
                "border border-[#e4e7ec]",
                "bg-white",
                "px-3 text-[13px] font-semibold text-[#101936]",
                "outline-none transition",
                "placeholder:text-[#98a2b3]",
                "focus:border-[#7c3aed] focus:ring-2 focus:ring-violet-100",
                "active:scale-[0.995]",
                "sm:h-9 sm:rounded-md sm:text-[12px]",
                // DESKTOP intacto
                "xl:border-[#d0d5dd] xl:bg-white xl:font-medium xl:text-[#172033] xl:placeholder:text-[#98a2b3] xl:focus:border-[#7c3aed] xl:focus:ring-violet-100",
                className,
            ].join(" ")}
            {...props}
        />
    );
}