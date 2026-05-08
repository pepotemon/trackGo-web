"use client";
import { useEffect } from "react";

export function NoContextMenu() {
    useEffect(() => {
        const block = (e: Event) => e.preventDefault();
        document.addEventListener("contextmenu", block);
        return () => document.removeEventListener("contextmenu", block);
    }, []);
    return null;
}
