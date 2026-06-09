"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

type UserCampaignData = {
    campaignIds: string[];
    cityNames: string[];
    loading: boolean;
};

export function useUserCampaignIds(userId: string | null | undefined): UserCampaignData {
    const [data, setData] = useState<UserCampaignData>({ campaignIds: [], cityNames: [], loading: true });

    useEffect(() => {
        if (!userId) {
            setData({ campaignIds: [], cityNames: [], loading: false });
            return;
        }

        setData((prev) => ({ ...prev, loading: true }));

        // Querying `subscriptions` (not `cities`) because Firestore rules allow vendors
        // to read their own subscription docs. The `cities` collection has no client read rule.
        const q = query(
            collection(db, "subscriptions"),
            where("userId", "==", userId),
            where("status", "==", "active")
        );

        return onSnapshot(
            q,
            (snap) => {
                const campaignIds: string[] = [];
                const cityNames: string[] = [];
                for (const docSnap of snap.docs) {
                    const d = docSnap.data();
                    const campaignId = d.campaignId as string | null | undefined;
                    if (campaignId && typeof campaignId === "string" && campaignId.trim()) {
                        campaignIds.push(campaignId.trim());
                        if (d.city) cityNames.push(String(d.city));
                    }
                }
                setData({ campaignIds: [...new Set(campaignIds)], cityNames, loading: false });
            },
            () => setData({ campaignIds: [], cityNames: [], loading: false })
        );
    }, [userId]);

    return data;
}
