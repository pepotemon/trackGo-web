"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type VendorSubscriptionStatus = "loading" | "active" | "inactive";

export function useVendorSubscriptionStatus(userId?: string | null): VendorSubscriptionStatus {
    const [status, setStatus] = useState<VendorSubscriptionStatus>(userId ? "loading" : "inactive");

    useEffect(() => {
        if (!userId) {
            setStatus("inactive");
            return;
        }

        setStatus("loading");
        const q = query(collection(db, "subscriptions"), where("userId", "==", userId));
        return onSnapshot(
            q,
            (snap) => {
                const active = snap.docs.some((doc) => doc.data().status === "active");
                setStatus(active ? "active" : "inactive");
            },
            () => setStatus("inactive"),
        );
    }, [userId]);

    return status;
}
