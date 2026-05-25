import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    limit,
    getDocs,
    orderBy,
    query,
    startAfter,
    updateDoc,
    where,
    type DocumentData,
    type QueryConstraint,
    type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
    LeadHistoryBucket,
    LeadQueuePage,
    LeadQueuePageCursor,
    LeadQueueCityFilter,
    LeadDetailsPatch,
    LeadParseStatus,
    LeadReviewStatus,
    LeadStatusPatch,
    MetaLeadDoc,
} from "@/types/leads";

const LEAD_HISTORY_STALE_DAYS = 30;
const LEAD_HISTORY_STALE_MS = LEAD_HISTORY_STALE_DAYS * 24 * 60 * 60 * 1000;

const QUEUE_STATUSES: LeadReviewStatus[] = [
    "pending_review",
    "incomplete",
    "not_suitable",
];

const HISTORY_STATUSES: LeadHistoryBucket[] = [
    "incomplete",
    "not_suitable",
];

const DEFAULT_PAGE_SIZE = 80;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
    return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function toMs(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    if (value && typeof value === "object" && "toMillis" in value) {
        const millis = (value as { toMillis: () => number }).toMillis();
        return Number.isFinite(millis) ? millis : null;
    }
    return null;
}

function numberOrNull(value: unknown) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeParseStatus(value: unknown): LeadParseStatus {
    const raw = text(value).toLowerCase();
    if (raw === "ready" || raw === "partial" || raw === "empty") return raw;
    return "empty";
}

function normalizeVerificationStatus(value: unknown): LeadReviewStatus | null {
    const raw = text(value).toLowerCase();
    if (
        raw === "verified" ||
        raw === "pending_review" ||
        raw === "incomplete" ||
        raw === "not_suitable"
    ) {
        return raw;
    }
    return null;
}

function normalizeLeadQuality(value: unknown): MetaLeadDoc["leadQuality"] {
    const raw = text(value).toLowerCase();
    if (
        raw === "unknown" ||
        raw === "valid" ||
        raw === "review" ||
        raw === "not_suitable"
    ) {
        return raw;
    }
    return "unknown";
}

function deriveVerificationStatus(raw: UnknownRecord): LeadReviewStatus {
    const explicit = normalizeVerificationStatus(raw.verificationStatus);
    if (explicit) return explicit;

    if (normalizeLeadQuality(raw.leadQuality) === "not_suitable") {
        return "not_suitable";
    }

    return normalizeParseStatus(raw.parseStatus) === "ready"
        ? "pending_review"
        : "incomplete";
}

function hasUsefulBusiness(raw: UnknownRecord) {
    return !!(text(raw.business) || text(raw.businessRaw));
}

function hasUsefulMaps(raw: UnknownRecord) {
    const mapsUrl = !!text(raw.mapsUrl);
    const lat = numberOrNull(raw.lat);
    const lng = numberOrNull(raw.lng);
    const currentLeadMapsConfirmedAt = numberOrNull(raw.currentLeadMapsConfirmedAt);

    return (mapsUrl || (lat != null && lng != null)) && !!currentLeadMapsConfirmedAt;
}

function quickStatusText(raw: UnknownRecord, status: LeadReviewStatus) {
    if (status === "not_suitable") {
        return text(raw.notSuitableReason) || "Perfil no apto";
    }

    if (status === "incomplete") {
        const missingBusiness = !hasUsefulBusiness(raw);
        const missingMaps = !hasUsefulMaps(raw);

        if (missingBusiness && missingMaps) return "Falta negocio y maps";
        if (missingBusiness) return "Falta negocio";
        if (missingMaps) return "Falta maps";
        return "Faltan datos por revisar";
    }

    if (status === "verified") return "Lead validado";
    return "Listo para revision";
}

function geoDisplayLabel(raw: UnknownRecord) {
    const city = text(raw.geoAdminCityLabel);
    const state = text(raw.geoAdminStateLabel);

    return (
        text(raw.geoAdminDisplayLabel) ||
        (city && state ? `${city} - ${state}` : "") ||
        city ||
        text(raw.geoCityLabel) ||
        text(raw.geoNearestHubLabel) ||
        state
    );
}

function getRelevantLeadActivityAt(lead: MetaLeadDoc) {
    if (lead.verificationStatus === "not_suitable") {
        return lead.verificationStatusChangedAt || lead.updatedAt || lead.createdAt || 0;
    }

    return (
        lead.lastInboundMessageAt ||
        lead.verificationStatusChangedAt ||
        lead.updatedAt ||
        lead.createdAt ||
        0
    );
}

export function getLeadHistoryBucket(
    lead: MetaLeadDoc,
    now = Date.now()
): LeadHistoryBucket | null {
    if (
        lead.verificationStatus !== "incomplete" &&
        lead.verificationStatus !== "not_suitable"
    ) {
        return null;
    }

    const relevantAt = getRelevantLeadActivityAt(lead);
    if (!relevantAt) return null;

    return now - relevantAt >= LEAD_HISTORY_STALE_MS
        ? (lead.verificationStatus as LeadHistoryBucket)
        : null;
}

export function isLeadInActiveQueue(lead: MetaLeadDoc, now = Date.now()) {
    if (lead.verificationStatus === "pending_review") return true;
    if (
        lead.verificationStatus !== "incomplete" &&
        lead.verificationStatus !== "not_suitable"
    ) {
        return false;
    }
    return getLeadHistoryBucket(lead, now) == null;
}

export function normalizeLeadDoc(id: string, data: UnknownRecord): MetaLeadDoc {
    const status = deriveVerificationStatus(data);
    const location = record(data.location);

    return {
        id,
        name: text(data.name) || text(data.profileName) || text(data.parsedName),
        business: text(data.business) || text(data.businessRaw) || text(data.parsedBusiness),
        phone: text(data.phone),
        waId: text(data.waId) || null,
        status:
            text(data.status) === "visited" || text(data.status) === "rejected"
                ? (text(data.status) as "visited" | "rejected")
                : "pending",
        source: text(data.source) === "whatsapp_meta" ? "whatsapp_meta" : "manual",
        parseStatus: normalizeParseStatus(data.parseStatus),
        verificationStatus: status,
        leadQuality: normalizeLeadQuality(data.leadQuality),
        notSuitableReason: text(data.notSuitableReason) || null,
        assignedTo: text(data.assignedTo),
        assignedAt: toMs(data.assignedAt),
        assignedDayKey:
            typeof data.assignedDayKey === "string" || typeof data.assignedDayKey === "number"
                ? data.assignedDayKey
                : null,
        autoAssignedAt: toMs(data.autoAssignedAt),
        autoAssignMatchType: text(data.autoAssignMatchType) as MetaLeadDoc["autoAssignMatchType"],
        autoAssignCoverageKey: text(data.autoAssignCoverageKey) || null,
        leadAcquisitionCityId: text(data.leadAcquisitionCityId) || null,
        leadAcquisitionCityLabel: text(data.leadAcquisitionCityLabel) || null,
        leadAcquisitionCampaignId: text(data.leadAcquisitionCampaignId) || null,
        leadAcquisitionSourceId: text(data.leadAcquisitionSourceId) || null,
        currentLeadMapsConfirmedAt: toMs(data.currentLeadMapsConfirmedAt),
        verifiedAt: toMs(data.verifiedAt),
        verifiedBy: text(data.verifiedBy) || null,
        verificationStatusChangedAt: toMs(data.verificationStatusChangedAt),
        leadHistoryArchivedAt: toMs(data.leadHistoryArchivedAt),
        leadHistoryBucket:
            text(data.leadHistoryBucket) === "incomplete" ||
            text(data.leadHistoryBucket) === "not_suitable"
                ? (text(data.leadHistoryBucket) as LeadHistoryBucket)
                : null,
        takenFromIncompleteAt: toMs(data.takenFromIncompleteAt),
        lastInboundMessageAt: toMs(data.lastInboundMessageAt),
        lastInboundText: text(data.lastInboundText) || null,
        adminQueueLastSeenMessageAt: toMs(data.adminQueueLastSeenMessageAt),
        adminQueueSeenAt: toMs(data.adminQueueSeenAt),
        userChatLastSeenMessageAt: toMs(data.userChatLastSeenMessageAt),
        userChatSeenAt: toMs(data.userChatSeenAt),
        userUnreadMessageCount: typeof data.userUnreadMessageCount === "number" ? data.userUnreadMessageCount : null,
        createdAt: toMs(data.createdAt),
        updatedAt: toMs(data.updatedAt),
        location: {
            cityLabel: text(data.geoCityLabel),
            cityNormalized: text(data.geoCityNormalized),
            displayLabel: geoDisplayLabel(data),
            adminCityLabel: text(data.geoAdminCityLabel),
            adminCityNormalized: text(data.geoAdminCityNormalized),
            adminStateLabel: text(data.geoAdminStateLabel),
            adminStateNormalized: text(data.geoAdminStateNormalized),
            adminCountryLabel: text(data.geoAdminCountryLabel),
            adminCountryNormalized: text(data.geoAdminCountryNormalized),
            address: text(data.address) || text(location.address),
            lat: numberOrNull(data.lat ?? location.lat),
            lng: numberOrNull(data.lng ?? location.lng),
            mapsUrl: text(data.mapsUrl),
            outOfCoverage: data.geoOutOfCoverage === true,
        },
        raw: {
            ...data,
            quickStatusText: quickStatusText(data, status),
        },
    };
}

function clampPageSize(value?: number) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(Math.floor(n), 150);
}

function normalizeQueueStatuses(statuses?: LeadReviewStatus[]) {
    const allowed = new Set<LeadReviewStatus>(QUEUE_STATUSES);
    const next = (statuses ?? QUEUE_STATUSES).filter((status) => allowed.has(status));
    return Array.from(new Set(next)).slice(0, 10);
}

function normalizeHistoryStatuses(statuses?: LeadHistoryBucket[]) {
    const allowed = new Set<LeadHistoryBucket>(HISTORY_STATUSES);
    const next = (statuses ?? HISTORY_STATUSES).filter((status) => allowed.has(status));
    return Array.from(new Set(next)).slice(0, 10);
}

export async function getLeadQueuePage({
    cursor,
    cursorLeadId,
    pageSize,
    statuses,
    city,
}: {
    cursor?: LeadQueuePageCursor | null;
    cursorLeadId?: string | null;
    pageSize?: number;
    statuses?: LeadReviewStatus[];
    city?: LeadQueueCityFilter | null;
} = {}): Promise<LeadQueuePage> {
    const normalizedStatuses = normalizeQueueStatuses(statuses);

    const constraints: QueryConstraint[] = [
        where("source", "==", "whatsapp_meta"),
        where("assignedTo", "==", ""),
        where("verificationStatus", "in", normalizedStatuses),
    ];

    if (city?.value) {
        constraints.push(where(city.field, "==", city.value));
    }

    constraints.push(orderBy("updatedAt", "desc"));

    if (cursor) {
        constraints.push(startAfter(cursor as QueryDocumentSnapshot<DocumentData>));
    } else if (cursorLeadId) {
        const cursorSnap = await getDoc(doc(db, "clients", cursorLeadId));
        if (cursorSnap.exists()) {
            constraints.push(startAfter(cursorSnap));
        }
    }

    constraints.push(limit(clampPageSize(pageSize)));

    const snap = await getDocs(query(collection(db, "clients"), ...constraints));
    const now = Date.now();
    const items = snap.docs
        .map((item) => normalizeLeadDoc(item.id, item.data()))
        .filter((lead) => isLeadInActiveQueue(lead, now));

    return {
        items,
        cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
        cursorLeadId: snap.docs.length ? snap.docs[snap.docs.length - 1].id : null,
        hasMore: snap.docs.length >= clampPageSize(pageSize),
    };
}

export async function getLeadQueueFacetLeads({
    statuses,
    maxPages = 10,
}: {
    statuses?: LeadReviewStatus[];
    maxPages?: number;
} = {}): Promise<MetaLeadDoc[]> {
    const map = new Map<string, MetaLeadDoc>();
    let cursor: LeadQueuePageCursor | null = null;
    let hasMore = true;
    let page = 0;

    while (hasMore && page < maxPages) {
        const result = await getLeadQueuePage({
            cursor,
            statuses,
            pageSize: 150,
        });

        for (const lead of result.items) {
            map.set(lead.id, lead);
        }

        cursor = result.cursor;
        hasMore = result.hasMore;
        page += 1;
    }

    return Array.from(map.values());
}

export async function getLeadHistoryPage({
    cursor,
    pageSize,
    buckets,
    city,
}: {
    cursor?: LeadQueuePageCursor | null;
    pageSize?: number;
    buckets?: LeadHistoryBucket[];
    city?: LeadQueueCityFilter | null;
} = {}): Promise<LeadQueuePage> {
    const normalizedBuckets = normalizeHistoryStatuses(buckets);
    const staleBefore = Date.now() - LEAD_HISTORY_STALE_MS;

    const constraints: QueryConstraint[] = [
        where("source", "==", "whatsapp_meta"),
        where("assignedTo", "==", ""),
        where("verificationStatus", "in", normalizedBuckets),
        where("updatedAt", "<=", staleBefore),
    ];

    if (city?.value) {
        constraints.push(where(city.field, "==", city.value));
    }

    constraints.push(orderBy("updatedAt", "desc"));

    if (cursor) {
        constraints.push(startAfter(cursor as QueryDocumentSnapshot<DocumentData>));
    }

    constraints.push(limit(clampPageSize(pageSize)));

    const snap = await getDocs(query(collection(db, "clients"), ...constraints));
    const now = Date.now();
    const items = snap.docs
        .map((item) => normalizeLeadDoc(item.id, item.data()))
        .filter((lead) => getLeadHistoryBucket(lead, now) != null);

    return {
        items,
        cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
        cursorLeadId: snap.docs.length ? snap.docs[snap.docs.length - 1].id : null,
        hasMore: snap.docs.length >= clampPageSize(pageSize),
    };
}

function stripUndefined(input: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
    );
}

export async function updateLeadStatus(
    leadId: string,
    patch: LeadStatusPatch
) {
    const now = Date.now();

    await updateDoc(
        doc(db, "clients", leadId),
        stripUndefined({
            ...patch,
            verificationStatusChangedAt: now,
            leadHistoryArchivedAt: null,
            leadHistoryBucket: null,
            updatedAt: now,
        })
    );
}

export async function updateLeadDetails(leadId: string, patch: LeadDetailsPatch) {
    const now = Date.now();

    await updateDoc(
        doc(db, "clients", leadId),
        stripUndefined({
            ...patch,
            verificationStatusChangedAt: patch.verificationStatus ? now : undefined,
            leadHistoryArchivedAt: patch.verificationStatus ? null : undefined,
            leadHistoryBucket: patch.verificationStatus ? null : undefined,
            updatedAt: now,
        })
    );
}

function dayKeyFromMs(ms: number) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export async function getClientCurrentStates(
    clientIds: string[]
): Promise<Map<string, { status: string; assignedTo: string | null; takenFromIncompleteAt?: number | null }>> {
    if (!clientIds.length) return new Map();

    const snapshots = await Promise.all(
        clientIds.map((id) => getDoc(doc(db, "clients", id)))
    );

    const map = new Map<string, { status: string; assignedTo: string | null; takenFromIncompleteAt?: number | null }>();
    for (const snap of snapshots) {
        if (snap.exists()) {
            const d = snap.data();
            const rawTs = d.takenFromIncompleteAt;
            const takenAt = typeof rawTs === "number" && Number.isFinite(rawTs) ? rawTs : null;
            map.set(snap.id, {
                status: String(d.status ?? ""),
                assignedTo: String(d.assignedTo ?? "") || null,
                takenFromIncompleteAt: takenAt,
            });
        }
    }
    return map;
}

export async function assignLeadToUser(leadId: string, userId: string) {
    const now = Date.now();

    await updateDoc(
        doc(db, "clients", leadId),
        stripUndefined({
            assignedTo: userId,
            assignedAt: userId ? now : 0,
            assignedDayKey: userId ? dayKeyFromMs(now) : "",
            status: "pending",
            statusBy: null,
            statusAt: null,
            rejectedReason: null,
            rejectedReasonText: null,
            note: null,
            leadHistoryArchivedAt: null,
            leadHistoryBucket: null,
            updatedAt: now,
        })
    );
}

export async function deleteLead(leadId: string) {
    await deleteDoc(doc(db, "clients", leadId));
}

export async function reopenLeadForReview(leadId: string) {
    const now = Date.now();

    await updateDoc(
        doc(db, "clients", leadId),
        stripUndefined({
            verificationStatus: "pending_review",
            leadQuality: "review",
            notSuitableReason: "",
            verificationStatusChangedAt: now,
            leadHistoryArchivedAt: null,
            leadHistoryBucket: null,
            updatedAt: now,
        })
    );
}
