import type { ReactNode } from "react";

export function Modal({
    open,
    title,
    subtitle,
    size = "md",
    children,
    onClose,
}: {
    open: boolean;
    title: string;
    subtitle?: string;
    size?: "sm" | "md" | "lg";
    children: ReactNode;
    onClose: () => void;
}) {
    if (!open) return null;

    const maxWidth = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : "max-w-xl";

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101936]/35 p-0 backdrop-blur-md sm:items-center sm:p-4">
            <div className={`flex max-h-[min(88vh,760px)] w-full ${maxWidth} flex-col overflow-hidden rounded-t-3xl border border-white/[0.08] bg-[#111827] shadow-[0_28px_80px_rgba(0,0,0,0.35)] sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl xl:border-[#e8e7fb] xl:bg-white xl:shadow-[0_28px_80px_rgba(16,25,54,0.24)]`}>
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.08] bg-[#0F172A] px-4 py-4 sm:px-5 xl:border-[#eef1f5] xl:bg-gradient-to-r xl:from-white xl:to-[#f8f7ff]">
                    <div>
                        <h2 className="text-[16px] font-black tracking-[-0.02em] text-[#F9FAFB] xl:font-bold xl:text-[#101936]">
                            {title}
                        </h2>
                        {subtitle ? (
                            <p className="mt-1 text-[12px] font-bold leading-snug text-[#9CA3AF] xl:font-medium xl:text-[#66739a]">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar modal"
                        className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[20px] leading-none text-[#CBD5E1] shadow-sm hover:bg-white/[0.08] hover:text-[#F9FAFB] xl:border-[#e8e7fb] xl:bg-white xl:text-[#66739a] xl:hover:bg-[#f2f4f7] xl:hover:text-[#101936]"
                    >
                        x
                    </button>
                </div>

                <div className="overflow-y-auto p-4 sm:p-5">{children}</div>
            </div>
        </div>
    );
}
