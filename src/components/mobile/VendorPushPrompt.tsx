"use client";

import { useEffect, useState } from "react";
import { enableWebPushForUser, getWebPushState, refreshWebPushTokenForUser, type WebPushState } from "@/lib/webPush";

type Props = {
    userId: string;
};

export function VendorPushPrompt({ userId }: Props) {
    const [state, setState] = useState<WebPushState | "checking">("checking");
    const [busy, setBusy] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let alive = true;
        getWebPushState().then((next) => {
            if (!alive) return;
            setState(next);
            if (next === "granted") void refreshWebPushTokenForUser(userId);
        });
        return () => { alive = false; };
    }, [userId]);

    if (dismissed || state === "checking" || state === "granted" || state === "denied" || state === "unsupported") {
        return null;
    }

    const missingVapid = state === "missing_vapid";

    async function enable() {
        setBusy(true);
        try {
            await enableWebPushForUser(userId);
            setState("granted");
        } catch (error) {
            console.warn("[webPush] enable failed", error);
            setState(error instanceof Error && error.message === "missing_vapid" ? "missing_vapid" : "default");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-x-3 bottom-[84px] z-50 mx-auto max-w-md rounded-[18px] border border-violet-200 bg-white/96 p-3 shadow-[0_18px_55px_rgba(91,33,255,0.18)] backdrop-blur-xl xl:bottom-4 xl:left-auto xl:right-4 xl:mx-0">
            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#f3f0ff] text-[#7C3AED]">
                    <BellIcon />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-black text-[#101936]">Activa avisos de clientes nuevos</p>
                    <p className="mt-0.5 text-[11px] font-semibold leading-snug text-[#66739A]">
                        Te avisaremos cuando recibas un prospecto asignado.
                    </p>
                    {missingVapid ? (
                        <p className="mt-1 text-[10px] font-bold text-amber-700">Falta configurar la clave VAPID en el entorno.</p>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#98A2B3] active:bg-[#f3f0ff]"
                    aria-label="Cerrar"
                >
                    x
                </button>
            </div>
            {!missingVapid ? (
                <button
                    type="button"
                    onClick={enable}
                    disabled={busy}
                    className="mt-3 h-10 w-full rounded-[13px] bg-[#7C3AED] text-[12px] font-black text-white shadow-md disabled:opacity-60"
                >
                    {busy ? "Activando..." : "Activar notificaciones"}
                </button>
            ) : null}
        </div>
    );
}

function BellIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
    );
}
