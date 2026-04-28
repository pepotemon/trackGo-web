import type { ReactNode } from "react";

export function Modal({
    open,
    title,
    subtitle,
    children,
    onClose,
}: {
    open: boolean;
    title: string;
    subtitle?: string;
    children: ReactNode;
    onClose: () => void;
}) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
            <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-2xl">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#f0f1f2] px-5 py-4">
                    <div>
                        <h2 className="text-[15px] font-semibold text-[#171717]">
                            {title}
                        </h2>
                        {subtitle ? (
                            <p className="mt-1 text-[12px] font-medium text-[#9ca3af]">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-2 py-1 text-[18px] leading-none text-[#71717a] hover:bg-[#f4f5f6]"
                    >
                        ×
                    </button>
                </div>

                <div className="overflow-y-auto p-5">{children}</div>
            </div>
        </div>
    );
}
