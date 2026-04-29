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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101936]/35 p-4 backdrop-blur-md">
            <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#e8e7fb] bg-white shadow-[0_28px_80px_rgba(16,25,54,0.24)]">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eef1f5] bg-gradient-to-r from-white to-[#f8f7ff] px-5 py-4">
                    <div>
                        <h2 className="text-[16px] font-bold tracking-[-0.02em] text-[#101936]">
                            {title}
                        </h2>
                        {subtitle ? (
                            <p className="mt-1 text-[12px] font-medium text-[#66739a]">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar modal"
                        className="rounded-lg px-2 py-1 text-[20px] leading-none text-[#66739a] hover:bg-[#f2f4f7] hover:text-[#101936]"
                    >
                        ×
                    </button>
                </div>

                <div className="overflow-y-auto p-5">{children}</div>
            </div>
        </div>
    );
}
