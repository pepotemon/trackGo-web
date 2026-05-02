import { useEffect, type ReactNode } from "react";

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
    useEffect(() => {
        if (!open) return;
        window.history.pushState({ modal: true }, "");
        const handlePop = () => onClose();
        window.addEventListener("popstate", handlePop);
        return () => {
            window.removeEventListener("popstate", handlePop);
        };
    }, [open, onClose]);

    if (!open) return null;

    const maxWidth = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : "max-w-xl";

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-[#101936]/25 p-0 backdrop-blur-md sm:items-center sm:p-4"
            onClick={onClose}
        >
            <div
                className={`flex max-h-[min(88vh,760px)] w-full ${maxWidth} flex-col overflow-hidden rounded-t-3xl border border-[#e8e7fb] bg-white shadow-[0_28px_80px_rgba(16,25,54,0.24)] sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eef1f5] bg-gradient-to-r from-white to-[#f8f7ff] px-4 py-4 sm:px-5">
                    <div>
                        <h2 className="text-[16px] font-black tracking-[-0.02em] text-[#101936] xl:font-bold">
                            {title}
                        </h2>

                        {subtitle ? (
                            <p className="mt-1 text-[12px] font-semibold leading-snug text-[#66739a] xl:font-medium">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>
                </div>

                <div className="overflow-y-auto bg-white p-4 text-[#101936] sm:p-5">
                    {children}
                </div>
            </div>
        </div>
    );
}