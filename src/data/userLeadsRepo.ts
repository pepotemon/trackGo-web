import {
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
    type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MetaLeadDoc } from "@/types/leads";
import type { DailyEventDoc } from "@/types/accounting";
import type { RejectedReason } from "@/types/userLeads";

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

function toNum(v: unknown): number | null {
    if (typeof v === "number" && isFinite(v)) return v;
    return null;
}

function toLoc(data: Record<string, unknown>) {
    const loc = record(data.location);
    return {
        displayLabel: text(loc.displayLabel),
        adminCityLabel: text(loc.adminCityLabel),
        cityLabel: text(loc.cityLabel),
        adminStateLabel: text(loc.adminStateLabel),
        adminCountryLabel: text(loc.adminCountryLabel),
        address: text(loc.address),
        lat: toNum(loc.lat),
        lng: toNum(loc.lng),
        mapsUrl: text(loc.mapsUrl),
        outOfCoverage: loc.outOfCoverage === true,
    };
}

function normalizeLead(id: string, data: Record<string, unknown>): MetaLeadDoc {
    return {
        id,
        name: text(data.name) || undefined,
        business: text(data.business) || undefined,
        phone: text(data.phone),
        waId: text(data.waId) || null,
        status: (data.status as MetaLeadDoc["status"]) ?? "pending",
        statusAt: toNum(data.statusAt),
        statusBy: text(data.statusBy) || null,
        rejectedReason: text(data.rejectedReason) || null,
        rejectedReasonText: text(data.rejectedReasonText) || null,
        source: (data.source as MetaLeadDoc["source"]) ?? "manual",
        parseStatus: (data.parseStatus as MetaLeadDoc["parseStatus"]) ?? "empty",
        verificationStatus: (data.verificationStatus as MetaLeadDoc["verificationStatus"]) ?? "pending_review",
        leadQuality: (data.leadQuality as MetaLeadDoc["leadQuality"]) ?? "unknown",
        notSuitableReason: text(data.notSuitableReason) || null,
        assignedTo: text(data.assignedTo),
        assignedAt: toNum(data.assignedAt),
        assignedDayKey: (data.assignedDayKey as string | null) ?? null,
        autoAssignedAt: toNum(data.autoAssignedAt),
        autoAssignMatchType: (data.autoAssignMatchType as MetaLeadDoc["autoAssignMatchType"]) ?? null,
        autoAssignCoverageKey: text(data.autoAssignCoverageKey) || null,
        currentLeadMapsConfirmedAt: toNum(data.currentLeadMapsConfirmedAt),
        verifiedAt: toNum(data.verifiedAt),
        verifiedBy: text(data.verifiedBy) || null,
        verificationStatusChangedAt: toNum(data.verificationStatusChangedAt),
        leadHistoryArchivedAt: toNum(data.leadHistoryArchivedAt),
        leadHistoryBucket: (data.leadHistoryBucket as MetaLeadDoc["leadHistoryBucket"]) ?? null,
        lastInboundMessageAt: toNum(data.lastInboundMessageAt),
        lastInboundText: text(data.lastInboundText) || null,
        adminQueueLastSeenMessageAt: toNum(data.adminQueueLastSeenMessageAt),
        adminQueueSeenAt: toNum(data.adminQueueSeenAt),
        createdAt: toNum(data.createdAt),
        updatedAt: toNum(data.updatedAt),
        location: toLoc(data),
        raw: record(data.raw),
    };
}

/** Real-time subscription to all leads assigned to this vendor. */
export function subscribeUserLeads(
    userId: string,
    callback: (leads: MetaLeadDoc[]) => void
): Unsubscribe {
    // No orderBy here — composite index not guaranteed; sort client-side.
    const q = query(
        collection(db, "clients"),
        where("assignedTo", "==", userId)
    );

    return onSnapshot(
        q,
        (snap) => {
            const leads = snap.docs
                .map((d) => normalizeLead(d.id, record(d.data())))
                .sort((a, b) => (b.assignedAt ?? 0) - (a.assignedAt ?? 0));
            callback(leads);
        },
        (err) => {
            console.error("[subscribeUserLeads]", err.message);
            callback([]);
        }
    );
}

/** Real-time subscription to daily events for stats (HOY / SEMANA). */
export function subscribeUserDailyEvents(
    userId: string,
    startKey: string,
    endKey: string,
    callback: (events: DailyEventDoc[]) => void
): Unsubscribe {
    // Range filter + equality on different fields — skip orderBy to avoid composite index requirement.
    const q = query(
        collection(db, "dailyEvents"),
        where("userId", "==", userId),
        where("dayKey", ">=", startKey),
        where("dayKey", "<=", endKey)
    );

    return onSnapshot(
        q,
        (snap) => {
        const events = snap.docs.map((d) => {
            const data = record(d.data());
            return {
                id: d.id,
                type: text(data.type) as DailyEventDoc["type"],
                userId: text(data.userId),
                clientId: text(data.clientId),
                createdAt: toNum(data.createdAt) ?? 0,
                dayKey: text(data.dayKey),
                phone: text(data.phone) || undefined,
                name: text(data.name) || undefined,
                business: text(data.business) || undefined,
                address: text(data.address) || undefined,
                mapsUrl: text(data.mapsUrl) || undefined,
                rateApplied: toNum(data.rateApplied) ?? undefined,
                amount: toNum(data.amount) ?? undefined,
                rejectedReason: text(data.rejectedReason) || null,
                rejectedReasonText: text(data.rejectedReasonText) || null,
                note: text(data.note) || null,
            } satisfies DailyEventDoc;
        });
        callback(events.sort((a, b) => a.dayKey.localeCompare(b.dayKey)));
        },
        (err) => {
            console.error("[subscribeUserDailyEvents]", err.message);
            callback([]);
        }
    );
}

function eventId(dayKey: string, leadId: string): string {
    return `${dayKey}_${leadId}`;
}

/** Mark a lead as visited and write the dailyEvent record. */
export async function markLeadVisited(lead: MetaLeadDoc, userId: string): Promise<void> {
    const day = todayKey();
    const now = Date.now();

    await updateDoc(doc(db, "clients", lead.id), {
        status: "visited",
        statusBy: userId,
        statusAt: now,
        updatedAt: now,
    });

    await setDoc(doc(db, "dailyEvents", eventId(day, lead.id)), {
        type: "visited",
        userId,
        clientId: lead.id,
        createdAt: now,
        dayKey: day,
        phone: lead.phone ?? "",
        name: lead.name ?? "",
        business: lead.business ?? "",
        address: lead.location.address ?? "",
        mapsUrl: lead.location.mapsUrl ?? "",
        rejectedReason: null,
        rejectedReasonText: null,
        note: null,
    });
}

/** Mark a lead as rejected with a reason and write the dailyEvent record. */
export async function markLeadRejected(
    lead: MetaLeadDoc,
    userId: string,
    reason: RejectedReason,
    reasonText: string
): Promise<void> {
    const day = todayKey();
    const now = Date.now();

    await updateDoc(doc(db, "clients", lead.id), {
        status: "rejected",
        statusBy: userId,
        statusAt: now,
        rejectedReason: reason,
        rejectedReasonText: reason === "otro" ? reasonText : null,
        updatedAt: now,
    });

    await setDoc(doc(db, "dailyEvents", eventId(day, lead.id)), {
        type: "rejected",
        userId,
        clientId: lead.id,
        createdAt: now,
        dayKey: day,
        phone: lead.phone ?? "",
        name: lead.name ?? "",
        business: lead.business ?? "",
        address: lead.location.address ?? "",
        mapsUrl: lead.location.mapsUrl ?? "",
        rejectedReason: reason,
        rejectedReasonText: reason === "otro" ? reasonText : null,
        note: null,
    });
}

/** Reset a lead back to pending (undo visited/rejected, only for today's actions). */
export async function resetLeadPending(lead: MetaLeadDoc, userId: string): Promise<void> {
    const day = todayKey();
    const now = Date.now();

    await updateDoc(doc(db, "clients", lead.id), {
        status: "pending",
        statusBy: null,
        statusAt: null,
        rejectedReason: null,
        rejectedReasonText: null,
        updatedAt: now,
    });

    await setDoc(doc(db, "dailyEvents", eventId(day, lead.id)), {
        type: "pending",
        userId,
        clientId: lead.id,
        createdAt: now,
        dayKey: day,
        phone: lead.phone ?? "",
        name: lead.name ?? "",
        business: lead.business ?? "",
        address: lead.location.address ?? "",
        mapsUrl: lead.location.mapsUrl ?? "",
        rejectedReason: null,
        rejectedReasonText: null,
        note: null,
    });
}
