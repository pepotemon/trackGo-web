"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import {
    disableWebPushForUser,
    enableWebPushForUser,
    getSavedWebPushTokenId,
    getWebPushState,
    refreshWebPushTokenForUser,
    type WebPushState,
} from "@/lib/webPush";

export function PushSettingsPanel({ userId, roleLabel = "tu cuenta" }: { userId: string; roleLabel?: string }) {
    const [permissionState, setPermissionState] = useState<WebPushState | "checking">("checking");
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");

    async function refreshState() {
        const state = await getWebPushState();
        setPermissionState(state);
        const localToken = getSavedWebPushTokenId(userId);
        setEnabled(state === "granted" && Boolean(localToken));
        if (state === "granted" && localToken) void refreshWebPushTokenForUser(userId);
    }

    useEffect(() => {
        void refreshState();
    }, [userId]);

    async function enable() {
        setBusy(true);
        setMessage("");
        try {
            await enableWebPushForUser(userId);
            await refreshState();
            setMessage("Notificaciones activadas en este dispositivo.");
        } catch (error) {
            const code = error instanceof Error ? error.message : "";
            setMessage(
                code === "permission_denied"
                    ? "El navegador bloqueo las notificaciones. Activalas desde los permisos del sitio."
                    : code === "missing_vapid"
                        ? "Falta configurar la clave VAPID en el entorno."
                        : "No se pudieron activar las notificaciones.",
            );
        } finally {
            setBusy(false);
        }
    }

    async function disable() {
        setBusy(true);
        setMessage("");
        try {
            await disableWebPushForUser(userId);
            await refreshState();
            setMessage("Notificaciones desactivadas en TrackGo para este dispositivo.");
        } catch {
            setMessage("No se pudieron desactivar las notificaciones.");
        } finally {
            setBusy(false);
        }
    }

    const unsupported = permissionState === "unsupported";
    const missingVapid = permissionState === "missing_vapid";
    const denied = permissionState === "denied";

    return (
        <section className="rounded-[28px] border border-[#e8e7fb] bg-white p-4 shadow-[0_18px_46px_rgba(91,33,255,0.08)]">
            <div className="flex items-start gap-3">
                <AppIcon name="alert" size="lg" tone={enabled ? "green" : "purple"} />
                <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-black text-[#101936]">Avisos push</p>
                    <p className="mt-1 text-[12px] font-semibold leading-snug text-[#66739a]">
                        Controla si este dispositivo recibe notificaciones para {roleLabel}.
                    </p>
                </div>
                <span
                    className={[
                        "rounded-full px-2.5 py-1 text-[10px] font-black uppercase",
                        enabled ? "bg-emerald-50 text-emerald-700" : "bg-[#f3f0ff] text-[#6d28d9]",
                    ].join(" ")}
                >
                    {permissionState === "checking" ? "Revisando" : enabled ? "Activo" : "Inactivo"}
                </span>
            </div>

            <div className="mt-4 rounded-2xl border border-[#edf0f6] bg-[#fbfaff] p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">
                    Estado del navegador
                </p>
                <p className="mt-1 text-[13px] font-bold text-[#101936]">{stateLabel(permissionState)}</p>
                {denied ? (
                    <p className="mt-1 text-[11px] font-semibold text-amber-700">
                        Para volver a activar, cambia el permiso desde la configuración del navegador.
                    </p>
                ) : null}
                {missingVapid ? (
                    <p className="mt-1 text-[11px] font-semibold text-amber-700">
                        Falta `NEXT_PUBLIC_FIREBASE_VAPID_KEY` en el entorno.
                    </p>
                ) : null}
                {unsupported ? (
                    <p className="mt-1 text-[11px] font-semibold text-amber-700">
                        Este navegador o modo de app no soporta push web.
                    </p>
                ) : null}
            </div>

            {message ? (
                <p className="mt-3 rounded-2xl bg-[#f8f7ff] px-3 py-2 text-[12px] font-bold text-[#4f46e5]">
                    {message}
                </p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                    type="button"
                    variant="primary"
                    onClick={enable}
                    disabled={busy || enabled || denied || unsupported || missingVapid || permissionState === "checking"}
                    className="!rounded-2xl"
                >
                    Activar
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={disable}
                    disabled={busy || !enabled}
                    className="!rounded-2xl"
                >
                    Desactivar
                </Button>
            </div>
        </section>
    );
}

function stateLabel(state: WebPushState | "checking") {
    if (state === "checking") return "Revisando permisos...";
    if (state === "granted") return "Permitido por el navegador";
    if (state === "default") return "Pendiente de activar";
    if (state === "denied") return "Bloqueado por el navegador";
    if (state === "missing_vapid") return "Clave push no configurada";
    return "No compatible";
}
