"use client";

import { useRef, useState } from "react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { getWaDailyCount, incrementWaDailyCount, WA_DAILY_LIMIT } from "@/lib/whatsappDailyCounter";
import { WhatsAppLimitModal } from "@/components/WhatsAppLimitModal";

export function useWhatsAppDailyLimit(): {
    triggerWa: (action: () => unknown) => void;
    WaLimitModal: ReactNode;
} {
    const [showModal, setShowModal] = useState(false);
    const [countAtWarning, setCountAtWarning] = useState(0);
    const pendingRef = useRef<(() => unknown) | null>(null);

    function triggerWa(action: () => unknown) {
        const currentCount = getWaDailyCount();
        if (currentCount >= WA_DAILY_LIMIT) {
            setCountAtWarning(currentCount);
            pendingRef.current = action;
            setShowModal(true);
            return;
        }
        incrementWaDailyCount();
        action();
    }

    function handleConfirm() {
        incrementWaDailyCount();
        void pendingRef.current?.();
        pendingRef.current = null;
        setShowModal(false);
    }

    function handleCancel() {
        pendingRef.current = null;
        setShowModal(false);
    }

    const WaLimitModal: ReactNode = showModal
        ? createElement(WhatsAppLimitModal, {
              count: countAtWarning,
              onConfirm: handleConfirm,
              onCancel: handleCancel,
          })
        : null;

    return { triggerWa, WaLimitModal };
}
