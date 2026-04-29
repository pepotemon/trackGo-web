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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#172033]/35 p-4 backdrop-blur-sm">
            <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-2xl">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eef1f5] px-5 py-4">
                    <div>
                        <h2 className="text-[15px] font-semibold text-[#172033]">
                            {title}
                        </h2>
                        {subtitle ? (
                            <p className="mt-1 text-[12px] font-medium text-[#667085]">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-2 py-1 text-[18px] leading-none text-[#667085] hover:bg-[#f2f4f7] hover:text-[#172033]"
                    >
                        x
                    </button>
                </div>

                <div className="overflow-y-auto p-5">{children}</div>
            </div>
        </div>
    );
}
