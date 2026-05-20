"use client";

import { useEffect } from "react";
import { WA_DAILY_LIMIT } from "@/lib/whatsappDailyCounter";

export function WhatsAppLimitModal({
    count,
    onConfirm,
    onCancel,
}: {
    count: number;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prev; };
    }, []);

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center xl:items-center">
            <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} aria-label="Cerrar" />
            <div className="relative w-full max-w-sm rounded-t-[24px] bg-white px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-5 shadow-2xl xl:rounded-[24px] xl:pb-6">
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#E8E7FB] xl:hidden" />

                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50">
                    <WarnIcon />
                </div>

                <p className="text-[10px] font-black uppercase tracking-[0.1em] text-amber-600">Limite recomendado alcanzado</p>
                <h2 className="mt-1 text-[20px] font-black tracking-[-0.03em] text-[#101936]">¡Cuidado con WhatsApp!</h2>

                <p className="mt-2 text-[13px] font-semibold leading-relaxed text-[#66739A]">
                    Ya llevas <strong className="font-black text-[#101936]">{count} mensajes</strong> de WhatsApp hoy.
                    Superar {WA_DAILY_LIMIT} envios diarios puede activar restricciones o bloqueos en tu numero.
                </p>

                <div className="mt-3 rounded-[14px] border border-violet-200 bg-violet-50 px-3 py-2.5">
                    <p className="text-[12px] font-black text-[#7C3AED]">Usa el chat de TrackGo en su lugar</p>
                    <p className="mt-0.5 text-[11px] font-semibold leading-snug text-[#5B21FF]/80">
                        El chat interno de TrackGo no tiene limite ni riesgo de bloqueo. Puedes seguir contactando a tus clientes desde ahi con total seguridad.
                    </p>
                </div>

                <p className="mt-3 text-[11px] font-semibold text-[#98A2B3]">
                    El contador se reinicia automaticamente manana.
                </p>

                <div className="mt-4 grid gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="h-11 w-full rounded-[14px] bg-[#7C3AED] text-[13px] font-black text-white"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="h-11 w-full rounded-[14px] border border-amber-200 bg-amber-50 text-[13px] font-black text-amber-800"
                    >
                        Enviar de todas formas
                    </button>
                </div>
            </div>
        </div>
    );
}

function WarnIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </svg>
    );
}
