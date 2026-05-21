"use client";

import { useRef, useState } from "react";
import { getWaDailyCount, incrementWaDailyCount, WA_DAILY_LIMIT } from "@/lib/whatsappDailyCounter";

export function useWhatsAppDailyLimit() {
    const [showModal, setShowModal] = useState(false);
    const [countAtWarning, setCountAtWarning] = useState(0);
    const pendingRef = useRef<(() => unknown) | null>(null);

    function triggerWa(action: () => unknown) {
        const currentCount = getWaDailyCount();
        if (currentCount >= WA_DAILY_LIMIT - 1) {
            setCountAtWarning(currentCount);
            pendingRef.current = action;
            setShowModal(true);
            return;
        }
        incrementWaDailyCount();
        action();
    }

    function confirmWa() {
        incrementWaDailyCount();
        void pendingRef.current?.();
        pendingRef.current = null;
        setShowModal(false);
    }

    function cancelWa() {
        pendingRef.current = null;
        setShowModal(false);
    }

    return { triggerWa, showModal, countAtWarning, confirmWa, cancelWa };
}
