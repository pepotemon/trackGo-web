"use client";

import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/ui";

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_KEY = "trackgo_install_prompt_dismissed_at";
const DISMISS_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 7;

function isStandalone() {
    if (typeof window === "undefined") return false;
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        ("standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
    );
}

function isIosSafariLike() {
    if (typeof window === "undefined") return false;
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isWebKit = /safari/.test(ua);
    const isChromeOrFirefox = /crios|fxios|edgios/.test(ua);
    return isIos && isWebKit && !isChromeOrFirefox;
}

function recentlyDismissed() {
    try {
        const value = window.localStorage.getItem(DISMISSED_KEY);
        if (!value) return false;
        const dismissedAt = Number(value);
        return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
    } catch {
        return false;
    }
}

export function InstallAppPrompt() {
    const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [showIosHelp, setShowIosHelp] = useState(false);
    const [visible, setVisible] = useState(false);
    const iosHelpAvailable = useMemo(() => isIosSafariLike(), []);

    useEffect(() => {
        if (isStandalone() || recentlyDismissed()) return;

        function handleBeforeInstallPrompt(event: Event) {
            event.preventDefault();
            setInstallEvent(event as BeforeInstallPromptEvent);
            setVisible(true);
        }

        function handleInstalled() {
            setVisible(false);
            setInstallEvent(null);
            setShowIosHelp(false);
        }

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.addEventListener("appinstalled", handleInstalled);

        if (iosHelpAvailable) {
            const timer = window.setTimeout(() => setVisible(true), 900);
            return () => {
                window.clearTimeout(timer);
                window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
                window.removeEventListener("appinstalled", handleInstalled);
            };
        }

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
            window.removeEventListener("appinstalled", handleInstalled);
        };
    }, [iosHelpAvailable]);

    async function install() {
        if (installEvent) {
            await installEvent.prompt();
            const choice = await installEvent.userChoice;
            if (choice.outcome === "accepted") {
                setVisible(false);
            }
            setInstallEvent(null);
            return;
        }

        if (iosHelpAvailable) {
            setShowIosHelp((prev) => !prev);
        }
    }

    function dismiss() {
        try {
            window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
        } catch { }
        setVisible(false);
        setShowIosHelp(false);
    }

    if (!visible || isStandalone()) return null;

    return (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+14px)] z-[120] flex justify-center px-4 print:hidden">
            <div className="w-full max-w-[390px] rounded-[22px] border border-white/70 bg-white/92 p-3 shadow-[0_18px_48px_rgba(73,41,143,0.18)] backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-gradient-to-br from-[#a78bfa] via-[#8b5cf6] to-[#6d28d9] shadow-[0_10px_24px_rgba(124,58,237,0.24)]">
                        <AppIcon name="download" tone="purple" size="sm" className="h-5 w-5 bg-transparent text-white ring-0" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-black text-[#172033]">Instala TrackGo</p>
                        <p className="truncate text-[11px] font-semibold text-[#7b8498]">Acceso rápido como app en tu dispositivo.</p>
                    </div>
                    <button
                        type="button"
                        onClick={install}
                        className="rounded-[13px] bg-[#7c3aed] px-3.5 py-2 text-[12px] font-black text-white shadow-[0_10px_22px_rgba(124,58,237,0.22)] transition active:scale-[0.98]"
                    >
                        Instalar
                    </button>
                    <button
                        type="button"
                        onClick={dismiss}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#98a2b3] transition active:bg-[#f3f0ff]"
                        aria-label="Ocultar instalación"
                    >
                        <AppIcon name="close" tone="slate" size="sm" className="h-4 w-4 bg-transparent ring-0" />
                    </button>
                </div>

                {showIosHelp ? (
                    <div className="mt-3 rounded-[16px] border border-violet-100 bg-[#f8f5ff] px-3 py-2 text-[11px] font-bold leading-relaxed text-[#6d54c8]">
                        En iPhone: toca compartir y luego “Agregar a pantalla de inicio”.
                    </div>
                ) : null}
            </div>
        </div>
    );
}
