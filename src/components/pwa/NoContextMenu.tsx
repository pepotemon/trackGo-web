"use client";
import { useEffect } from "react";

export function NoContextMenu() {
    useEffect(() => {
        const blockContext = (e: Event) => e.preventDefault();
        const blockZoom = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };

        document.addEventListener("contextmenu", blockContext);
        document.addEventListener("wheel", blockZoom, { passive: false });
        return () => {
            document.removeEventListener("contextmenu", blockContext);
            document.removeEventListener("wheel", blockZoom);
        };
    }, []);
    return null;
}
