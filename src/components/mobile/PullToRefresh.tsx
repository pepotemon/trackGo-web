"use client";

import { useEffect, useRef, useState } from "react";

type PullToRefreshProps = {
    disabled?: boolean;
    onRefresh?: () => void;
};

const THRESHOLD = 74;
const MAX_PULL = 116;

export function PullToRefresh({ disabled = false, onRefresh }: PullToRefreshProps) {
    const [distance, setDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const distanceRef = useRef(0);

    useEffect(() => {
        if (disabled) return;

        let startY = 0;
        let startX = 0;
        let pulling = false;
        let startedAtTop = false;

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
            const target = event.target;
            if (target instanceof Element && target.closest("[data-trackgo-modal='true']")) return;
            const touch = event.touches[0];
            if (!touch) return;
            startY = touch.clientY;
            startX = touch.clientX;
            pulling = false;
            startedAtTop = true;
        }

        function onTouchMove(event: TouchEvent) {
            if (!isMobile() || !startedAtTop || window.scrollY > 2 || refreshing) return;
            const touch = event.touches[0];
            if (!touch) return;

            const dy = touch.clientY - startY;
            const dx = Math.abs(touch.clientX - startX);
            if (dy <= 0 || dx > dy * 0.7) return;

            pulling = true;
            event.preventDefault();
            const nextDistance = Math.min(MAX_PULL, Math.pow(dy, 0.86) * 0.82);
            distanceRef.current = nextDistance;
            setDistance(nextDistance);
        }

        function onTouchEnd() {
            startedAtTop = false;
            if (!pulling || refreshing) {
                distanceRef.current = 0;
                setDistance(0);
                return;
            }

            if (distanceRef.current >= THRESHOLD) {
                refresh();
                return;
            }

            distanceRef.current = 0;
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
    }, [disabled, onRefresh, refreshing]);

    if (disabled || (distance <= 0 && !refreshing)) return null;

    const progress = Math.min(1, distance / THRESHOLD);
    const translate = refreshing ? 18 : distance - 58;
    const scale = 0.72 + progress * 0.28;

    return (
        <div
            className="pointer-events-none fixed left-0 right-0 top-0 z-[80] flex justify-center xl:hidden"
            style={{
                transform: `translateY(${translate}px)`,
                opacity: refreshing ? 1 : Math.max(0.18, progress),
                transition: refreshing ? "transform 180ms ease, opacity 180ms ease" : "none",
            }}
        >
            <div
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e8e7fb] bg-white/95 text-[#7C3AED] shadow-[0_14px_36px_rgba(91,33,255,0.18)] backdrop-blur-md"
                style={{ transform: `scale(${scale})` }}
            >
                <svg
                    className={refreshing || distance >= THRESHOLD ? "h-5 w-5 animate-spin" : "h-5 w-5"}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: refreshing ? undefined : `rotate(${progress * 210}deg)` }}
                >
                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                    <path d="M21 3v6h-6" />
                </svg>
            </div>
        </div>
    );
}
