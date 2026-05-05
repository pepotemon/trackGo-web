"use client";

import { useEffect, useRef, useState } from "react";

const SLEEP_RELOAD_MS = 2 * 60 * 1000;
const IDLE_RELOAD_MS = 8 * 60 * 1000;

function shouldRunOnThisDevice() {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 1279px)").matches
        || window.matchMedia("(display-mode: standalone)").matches
        || window.matchMedia("(display-mode: fullscreen)").matches;
}

export function ResumeRefresh() {
    const [refreshing, setRefreshing] = useState(false);
    const hiddenAt = useRef<number | null>(null);
    const lastInteractionAt = useRef(Date.now());
    const reloading = useRef(false);

    useEffect(() => {
        if (!shouldRunOnThisDevice()) return;

        function reloadCleanly() {
            if (reloading.current) return;
            reloading.current = true;
            setRefreshing(true);
            window.setTimeout(() => window.location.reload(), 120);
        }

        function onVisibilityChange() {
            if (document.visibilityState === "hidden") {
                hiddenAt.current = Date.now();
                return;
            }

            const sleptFor = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
            hiddenAt.current = null;

            if (sleptFor > SLEEP_RELOAD_MS) reloadCleanly();
        }

        function onPageShow(event: PageTransitionEvent) {
            if (event.persisted) reloadCleanly();
        }

        function onInteraction() {
            const now = Date.now();
            const idleFor = now - lastInteractionAt.current;
            lastInteractionAt.current = now;
            if (idleFor > IDLE_RELOAD_MS) reloadCleanly();
        }

        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("pageshow", onPageShow);
        window.addEventListener("pointerdown", onInteraction, { capture: true });

        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("pageshow", onPageShow);
            window.removeEventListener("pointerdown", onInteraction, { capture: true });
        };
    }, []);

    if (!refreshing) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/75 backdrop-blur-sm">
            <div className="rounded-2xl border border-[#e8e7fb] bg-white px-5 py-4 text-center shadow-[0_18px_50px_rgba(91,33,255,0.16)]">
                <svg className="tg-spin mx-auto h-6 w-6 text-[#7c3aed]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                </svg>
                <p className="mt-2 text-[12px] font-black text-[#101936]">Actualizando sesion</p>
            </div>
        </div>
    );
}
