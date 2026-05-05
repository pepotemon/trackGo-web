"use client";

import { useEffect, useRef } from "react";

let modalSequence = 0;

export function useBackButtonDismiss(open: boolean, onClose: () => void) {
    const onCloseRef = useRef(onClose);
    const cleanupTimerRef = useRef<number | null>(null);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open || typeof window === "undefined") return;

        if (cleanupTimerRef.current !== null) {
            window.clearTimeout(cleanupTimerRef.current);
            cleanupTimerRef.current = null;
        }

        const marker = `trackgo-modal-${Date.now()}-${modalSequence++}`;
        let closedByPop = false;

        window.history.pushState({ ...(window.history.state ?? {}), __trackgoModal: marker }, "");

        function handlePopState() {
            closedByPop = true;
            onCloseRef.current();
        }

        window.addEventListener("popstate", handlePopState);

        return () => {
            window.removeEventListener("popstate", handlePopState);

            if (!closedByPop && window.history.state?.__trackgoModal === marker) {
                cleanupTimerRef.current = window.setTimeout(() => {
                    cleanupTimerRef.current = null;

                    if (window.history.state?.__trackgoModal === marker) {
                        window.history.back();
                    }
                }, 80);
            }
        };
    }, [open]);
}
