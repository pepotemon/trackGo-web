"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

type UserCampaignData = {
    campaignIds: string[];
    cityNames: string[];
};

export function useUserCampaignIds(userId: string | null | undefined): UserCampaignData {
    const [data, setData] = useState<UserCampaignData>({ campaignIds: [], cityNames: [] });

    useEffect(() => {
        if (!userId) {
            setData({ campaignIds: [], cityNames: [] });
            return;
        }

        const q = query(
            collection(db, "subscriptionCities"),
            where("ownerUserId", "==", userId),
            where("status", "==", "occupied")
        );

        return onSnapshot(
            q,
            (snap) => {
                const campaignIds: string[] = [];
                const cityNames: string[] = [];
                for (const docSnap of snap.docs) {
                    const d = docSnap.data();
                    const campaignId = (d.activeCampaignId ?? d.campaignId) as string | null | undefined;
                    if (campaignId && typeof campaignId === "string" && campaignId.trim()) {
                        campaignIds.push(campaignId.trim());
                        if (d.name) cityNames.push(String(d.name));
                    }
                }
                setData({ campaignIds: [...new Set(campaignIds)], cityNames });
            },
            () => setData({ campaignIds: [], cityNames: [] })
        );
    }, [userId]);

    return data;
}
