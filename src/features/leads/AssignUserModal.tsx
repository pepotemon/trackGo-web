"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "@/components/ui";

type PickedUser = { id: string; name?: string; email?: string };

export function AssignUserModal({
    open,
    onClose,
    users,
    onAssign,
    saving = false,
    title = "Asignar a usuario",
}: {
    open: boolean;
    onClose: () => void;
    users: PickedUser[];
    onAssign: (userId: string) => void;
    saving?: boolean;
    title?: string;
}) {
    const [selectedId, setSelectedId] = useState("");

    useEffect(() => {
        if (!open) setSelectedId("");
    }, [open]);

    if (!open) return null;

    return (
        <>
            <button
                type="button"
                onClick={onClose}
                className="fixed inset-0 z-[60] bg-black/50 xl:hidden"
                aria-label="Cerrar"
            />
            <div className="fixed inset-x-0 bottom-0 z-[70] rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.22)] xl:hidden">
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#E8E7FB]" />

                <div className="mb-4 flex items-center gap-2">
                    <AppIcon name="assign" tone="purple" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                    <h3 className="text-[15px] font-black text-[#101936]">{title}</h3>
                </div>

                {users.length === 0 ? (
                    <p className="py-6 text-center text-[13px] font-semibold text-[#98A2B3]">
                        No hay usuarios activos disponibles.
                    </p>
                ) : (
                    <div className="grid max-h-[40vh] gap-2 overflow-y-auto">
                        {users.map((user) => {
                            const label = user.name || user.email || "Usuario";
                            const initial = label.charAt(0).toUpperCase();
                            const active = selectedId === user.id;
                            return (
                                <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => setSelectedId(user.id)}
                                    className={[
                                        "flex min-h-[52px] items-center gap-3 rounded-[14px] border px-4 text-left transition",
                                        active
                                            ? "border-violet-200 bg-[#f3f0ff]"
                                            : "border-[#E8E7FB] bg-white active:bg-[#f8f7ff]",
                                    ].join(" ")}
                                >
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#4f46e5] text-[13px] font-bold text-white">
                                        {initial}
                                    </div>
                                    <span className={[
                                        "min-w-0 flex-1 truncate text-[14px] font-bold",
                                        active ? "text-[#7C3AED]" : "text-[#101936]",
                                    ].join(" ")}>
                                        {label}
                                    </span>
                                    {active && (
                                        <AppIcon name="check" tone="purple" size="sm" className="h-5 w-5 shrink-0 bg-transparent text-[#7C3AED] ring-0" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => { if (selectedId) onAssign(selectedId); }}
                    disabled={!selectedId || saving}
                    className="mt-4 min-h-[52px] w-full rounded-[14px] bg-[#7C3AED] text-[14px] font-bold text-white transition active:bg-violet-700 disabled:opacity-40"
                >
                    {saving ? (
                        <span className="flex items-center justify-center gap-2">
                            <svg className="tg-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                            </svg>
                            Asignando…
                        </span>
                    ) : "Confirmar asignación"}
                </button>

                <button
                    type="button"
                    onClick={onClose}
                    className="mt-2 min-h-[46px] w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] text-[14px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                >
                    Cancelar
                </button>
            </div>
        </>
    );
}
