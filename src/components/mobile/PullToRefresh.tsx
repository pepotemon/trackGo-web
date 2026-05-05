"use client";

import { useEffect, useState } from "react";

type PullToRefreshProps = {
    disabled?: boolean;
    onRefresh?: () => void;
};

const THRESHOLD = 82;

export function PullToRefresh({ disabled = false, onRefresh }: PullToRefreshProps) {
    const [distance, setDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        if (disabled) return;

        let startY = 0;
        let startX = 0;
        let pulling = false;

        function isMobile() {
            return window.matchMedia("(max-width: 1279px)").matches;
        }

        function refresh() {
            setRefreshing(true);
            if (onRefresh) {
                onRefresh();
                window.setTimeout(() => {
                    setRefreshing(false);
                    setDistance(0);
                }, 450);
                return;
            }
            window.location.reload();
        }

        function onTouchStart(event: TouchEvent) {
            if (!isMobile() || window.scrollY > 0) return;
            const touch = event.touches[0];
            if (!touch) return;
            startY = touch.clientY;
            startX = touch.clientX;
            pulling = false;
        }

        function onTouchMove(event: TouchEvent) {
            if (!isMobile() || window.scrollY > 0 || refreshing) return;
            const touch = event.touches[0];
            if (!touch) return;

            const dy = touch.clientY - startY;
            const dx = Math.abs(touch.clientX - startX);
            if (dy <= 0 || dx > dy * 0.7) return;

            pulling = true;
            event.preventDefault();
            setDistance(Math.min(THRESHOLD + 24, dy * 0.55));
        }

        function onTouchEnd() {
            if (!pulling || refreshing) {
                setDistance(0);
                return;
            }

            if (distance >= THRESHOLD) {
                refresh();
                return;
            }

            setDistance(0);
        }

        window.addEventListener("touchstart", onTouchStart, { passive: true });
        window.addEventListener("touchmove", onTouchMove, { passive: false });
        window.addEventListener("touchend", onTouchEnd, { passive: true });

        return () => {
            window.removeEventListener("touchstart", onTouchStart);
            window.removeEventListener("touchmove", onTouchMove);
            window.removeEventListener("touchend", onTouchEnd);
        };
    }, [disabled, distance, onRefresh, refreshing]);

    if (disabled || (distance <= 0 && !refreshing)) return null;

    return (
        <div
            className="pointer-events-none fixed left-0 right-0 top-3 z-[80] flex justify-center xl:hidden"
            style={{ transform: `translateY(${Math.max(0, distance - 40)}px)` }}
        >
            <div className="flex h-10 items-center gap-2 rounded-full border border-[#e8e7fb] bg-white/95 px-4 text-[11px] font-black text-[#7C3AED] shadow-[0_14px_36px_rgba(91,33,255,0.18)] backdrop-blur-md">
                <svg className={refreshing || distance >= THRESHOLD ? "h-4 w-4 animate-spin" : "h-4 w-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                    <path d="M21 3v6h-6" />
                </svg>
                {refreshing ? "Actualizando" : distance >= THRESHOLD ? "Suelta para actualizar" : "Desliza para actualizar"}
            </div>
        </div>
    );
}

