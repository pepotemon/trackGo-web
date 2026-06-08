import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { ResponseError } from "@/server/auth";
import { adminDb } from "@/server/firebaseAdmin";
import { cancelMercadoPagoPayment, createPixPayment, getMercadoPagoPayment } from "@/server/subscriptions/mercadoPago";
import { calculateAdsBudget, calculateAdsBudgetAllocation, calculateCycleEnd, getPlanAmount } from "@/server/subscriptions/plans";
import { configureAndActivateCityCampaign, getMetaCampaignCycleSpend, getMetaCampaignSpendForRange, getMetaCampaignTotalSpend, pauseCityCampaign, resumeCityCampaign, updateCityCampaignDailyBudget } from "@/server/subscriptions/metaAds";
import { sendPushToUser } from "@/server/push";
import type { PixCheckoutResponse, SubscriptionPlanId } from "@/types/subscriptions";

const RESERVATION_TTL_MS = 30 * 60 * 1000;
const USER_BLOCKING_SUBSCRIPTION_STATUSES = ["active", "provisioning", "payment_approved_meta_failed", "expiring", "paused"];
const CITY_POOL_ACTIVE_SUBSCRIPTION_STATUSES = ["active", "provisioning"];
const CITY_POOL_PRESENT_SUBSCRIPTION_STATUSES = ["active", "provisioning", "paused"];

function nowMs() {
    return Date.now();
}

export async function listSubscriptionCities() {
    const snap = await adminDb.collection("cities").orderBy("name", "asc").get();

    return snap.docs.map((doc) => {
        const data = doc.data();
        const reservationExpiresAt = Number(data.reservationExpiresAt || 0) || null;
        const isExpiredReservation =
            data.status === "reserved" && reservationExpiresAt !== null && reservationExpiresAt < nowMs();

        return {
            id: doc.id,
            name: String(data.name || doc.id),
            state: typeof data.state === "string" ? data.state : null,
            country: typeof data.country === "string" ? data.country : null,
            status: isExpiredReservation ? "available" : data.status || "available",
            ownerUserId: data.ownerUserId || null,
            ownerUserIds: Array.isArray(data.ownerUserIds) ? data.ownerUserIds : [],
            activeSubscriptionIds: Array.isArray(data.activeSubscriptionIds) ? data.activeSubscriptionIds : [],
            activeParticipantsCount: Number(data.activeParticipantsCount || 0),
            sharedPoolDailyBudget: Number(data.sharedPoolDailyBudget || 0),
            sharedPoolTargetSpend: Number(data.sharedPoolTargetSpend || 0),
            sharedPoolSpendBaseline: Number(data.sharedPoolSpendBaseline || 0),
            campaignId: data.campaignId || null,
            baseCampaignId: data.baseCampaignId || null,
            campaignDeliveryStatus: data.campaignDeliveryStatus || null,
            reservedByCheckoutId: isExpiredReservation ? null : data.reservedByCheckoutId || null,
            reservationExpiresAt: isExpiredReservation ? null : reservationExpiresAt,
            note: typeof data.note === "string" && data.note ? data.note : null,
            updatedAt: Number(data.updatedAt || 0) || null,
        };
    });
}

export async function getSubscriptionSettings() {
    const snap = await adminDb.collection("subscriptionSettings").doc("global").get();
    const data = snap.data() || {};
    const adsShare = Number(data.adsShare ?? 0.5);

    return {
        adsShare: Number.isFinite(adsShare) ? Math.min(Math.max(adsShare, 0), 1) : 0.5,
        cycleDays: Number(data.cycleDays ?? 5) || 5,
        updatedAt: Number(data.updatedAt || 0) || null,
    };
}

export async function saveSubscriptionSettings(input: { adsShare: number; cycleDays: number }) {
    const adsShare = Number(input.adsShare);
    const cycleDays = Number(input.cycleDays);

    if (!Number.isFinite(adsShare) || adsShare < 0.1 || adsShare > 0.9) {
        throw new ResponseError("invalid_ads_share", "La distribucion de anuncios debe estar entre 10% y 90%.");
    }

    if (!Number.isFinite(cycleDays) || cycleDays < 1 || cycleDays > 30) {
        throw new ResponseError("invalid_cycle_days", "El ciclo debe estar entre 1 y 30 dias.");
    }

    await adminDb.collection("subscriptionSettings").doc("global").set(
        {
            adsShare,
            cycleDays: Math.round(cycleDays),
            updatedAt: nowMs(),
        },
        { merge: true },
    );

    return getSubscriptionSettings();
}

export async function getSubscriptionsOverview(scope?: { adminId?: string; isSuperAdmin?: boolean }) {
    const [cities, settings, usersSnap] = await Promise.all([
        listSubscriptionCities(),
        getSubscriptionSettings(),
        adminDb.collection("users").get(),
    ]);

    const users = new Map(
        usersSnap.docs.map((doc) => {
            const data = doc.data();
            return [
                doc.id,
                {
                    id: doc.id,
                    name: String(data.name || data.email || "Usuario"),
                    email: String(data.email || ""),
                },
            ];
        }),
    );

    const scopedUserIds = getScopedSubscriptionUserIds(usersSnap.docs, scope);
    const scopedUserSet = scopedUserIds ? new Set(scopedUserIds) : null;
    const [subscriptionsDocs, checkoutsDocs] = await Promise.all([
        listScopedSubscriptionDocs("subscriptions", scopedUserIds, 30),
        listScopedSubscriptionDocs("subscriptionCheckouts", scopedUserIds, 40),
    ]);

    const todayKey = dayKeyFromMs(Date.now());
    const citiesById = new Map(cities.map((city) => [city.id, city]));
    const subscriptions = await Promise.all(subscriptionsDocs.map(async (doc) => {
        const data = doc.data();
        const user = users.get(String(data.userId || ""));
        const status = data.status || "unknown";
        const campaignId = data.campaignId || null;
        const city = citiesById.get(String(data.cityId || ""));
        const isSharedPool = data.sharedPool === true || Number(city?.activeParticipantsCount || 0) > 1;
        const spendBaseline = isSharedPool
            ? Number(city?.sharedPoolSpendBaseline ?? data.spendBaseline ?? data.metaSpendBaseline ?? 0)
            : Number(data.spendBaseline ?? data.metaSpendBaseline ?? 0);
        const dailyBudget = isSharedPool
            ? Number(city?.sharedPoolDailyBudget || data.dailyBudget || data.metaDailyBudget || 0)
            : Number(data.dailyBudget || data.metaDailyBudget || 0);
        const targetSpend = isSharedPool
            ? Number(city?.sharedPoolTargetSpend || data.targetSpend || data.adsBudget || 0)
            : Number(data.targetSpend || data.adsBudget || 0);
        const spendSnapshot = await getSubscriptionSpendSnapshot({
            status,
            campaignId,
            spendBaseline,
            storedCycleSpend: Number(data.cycleSpend ?? 0),
            todayKey,
        });
        return {
            id: doc.id,
            userId: data.userId || null,
            userName: user?.name || "Usuario",
            userEmail: user?.email || "",
            cityId: data.cityId || null,
            city: data.city || null,
            plan: data.plan || null,
            amount: Number(data.amount || 0),
            adsBudget: Number(data.adsBudget || 0),
            adsShare: Number(data.adsShare ?? 0.5),
            cycleDays: Number(data.cycleDays || 5),
            status,
            source: data.source || null,
            sharedPool: isSharedPool,
            activeParticipantsCount: Number(city?.activeParticipantsCount || 0),
            campaignId,
            campaignName: data.campaignName || null,
            dailyBudget,
            targetSpend,
            spendPauseThreshold: Number(data.spendPauseThreshold || 0),
            cycleSpend: spendSnapshot.cycleSpend,
            todaySpend: spendSnapshot.todaySpend,
            totalSpend: spendSnapshot.totalSpend,
            spendUpdatedAt: spendSnapshot.updatedAt,
            spendStatus: spendSnapshot.status,
            startDate: timestampToMs(data.startDate),
            endDate: timestampToMs(data.endDate),
            createdAt: Number(data.createdAt || 0) || null,
            updatedAt: Number(data.updatedAt || 0) || null,
        };
    }));

    const checkouts = checkoutsDocs.map((doc) => {
        const data = doc.data();
        const user = users.get(String(data.userId || ""));
        return {
            id: doc.id,
            userId: data.userId || null,
            userName: user?.name || "Usuario",
            userEmail: user?.email || "",
            cityId: data.cityId || null,
            cityName: data.cityName || null,
            plan: data.plan || null,
            amount: Number(data.amount || 0),
            adsBudget: Number(data.adsBudget || 0),
            adsShare: Number(data.adsShare ?? 0.5),
            cycleDays: Number(data.cycleDays || 5),
            paymentId: data.paymentId || "",
            ticketUrl: data.ticketUrl || null,
            status: data.status || "unknown",
            activationStatus: data.activationStatus || "unknown",
            failureReason: data.failureReason || null,
            campaignId: data.campaignId || null,
            hiddenFromUser: data.hiddenFromUser === true,
            createdAt: Number(data.createdAt || 0) || null,
            updatedAt: Number(data.updatedAt || 0) || null,
            paymentApprovedAt: Number(data.paymentApprovedAt || 0) || null,
        };
    });

    return {
        settings,
        cities: scopedUserSet
            ? cities.filter((city) => city.status === "occupied" && Boolean(city.ownerUserId && scopedUserSet.has(city.ownerUserId)))
            : cities,
        subscriptions,
        checkouts,
    };
}

export async function getActiveSubscriptionUserIds(scope?: { adminId?: string; isSuperAdmin?: boolean }) {
    if (scope?.isSuperAdmin !== false || !scope?.adminId) {
        const snap = await adminDb.collection("subscriptions").where("status", "==", "active").get();
        return snap.docs.map((doc) => String(doc.data().userId || "")).filter(Boolean);
    }

    const usersSnap = await adminDb.collection("users").get();
    const scopedUserIds = getScopedSubscriptionUserIds(usersSnap.docs, scope);
    if (!scopedUserIds || scopedUserIds.length === 0) return [];

    const chunks: string[][] = [];
    for (let i = 0; i < scopedUserIds.length; i += 30) chunks.push(scopedUserIds.slice(i, i + 30));

    const snaps = await Promise.all(
        chunks.map((chunk) =>
            adminDb.collection("subscriptions").where("userId", "in", chunk).where("status", "==", "active").get(),
        ),
    );
    return snaps.flatMap((s) => s.docs).map((doc) => String(doc.data().userId || "")).filter(Boolean);
}

function getScopedSubscriptionUserIds(
    userDocs: Array<FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>>,
    scope?: { adminId?: string; isSuperAdmin?: boolean },
) {
    if (scope?.isSuperAdmin !== false || !scope?.adminId) return null;
    return userDocs
        .filter((doc) => {
            const data = doc.data();
            return data.role === "user" && Array.isArray(data.sharedWith)
                && data.sharedWith.some((entry: unknown) => {
                    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
                    return item.adminId === scope.adminId;
                });
        })
        .map((doc) => doc.id);
}

async function listScopedSubscriptionDocs(
    collectionName: "subscriptions" | "subscriptionCheckouts",
    scopedUserIds: string[] | null,
    limit: number,
) {
    if (scopedUserIds && scopedUserIds.length === 0) return [];
    if (!scopedUserIds) {
        const snap = await adminDb.collection(collectionName).orderBy("updatedAt", "desc").limit(limit).get();
        return snap.docs;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < scopedUserIds.length; i += 30) {
        chunks.push(scopedUserIds.slice(i, i + 30));
    }

    const snaps = await Promise.all(
        chunks.map((chunk) =>
            adminDb
                .collection(collectionName)
                .where("userId", "in", chunk)
                .limit(Math.max(limit, 100))
                .get(),
        ),
    );

    return snaps
        .flatMap((snap) => snap.docs)
        .sort((a, b) => Number(b.data().updatedAt || 0) - Number(a.data().updatedAt || 0))
        .slice(0, limit);
}

function dayKeyFromMs(ms: number) {
    const date = new Date(ms);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

async function getSubscriptionSpendSnapshot(input: {
    status: string;
    campaignId?: string | null;
    spendBaseline: number;
    storedCycleSpend: number;
    todayKey: string;
}) {
    const active = input.status === "active" || input.status === "expiring";
    if (!active || !input.campaignId) {
        return {
            cycleSpend: Number.isFinite(input.storedCycleSpend) ? input.storedCycleSpend : 0,
            todaySpend: 0,
            totalSpend: null as number | null,
            updatedAt: null as number | null,
            status: input.campaignId ? "stored" : "missing_campaign",
        };
    }

    try {
        const [cycle, todaySpend] = await Promise.all([
            getMetaCampaignCycleSpend({
                campaignId: input.campaignId,
                spendBaseline: Number.isFinite(input.spendBaseline) ? input.spendBaseline : 0,
            }),
            getMetaCampaignSpendForRange({
                campaignId: input.campaignId,
                since: input.todayKey,
                until: input.todayKey,
            }),
        ]);

        return {
            cycleSpend: cycle.cycleSpend,
            todaySpend,
            totalSpend: cycle.totalSpend,
            updatedAt: Date.now(),
            status: "live",
        };
    } catch (error) {
        console.warn("[subscriptions:spendSnapshot]", input.campaignId, error);
        return {
            cycleSpend: Number.isFinite(input.storedCycleSpend) ? input.storedCycleSpend : 0,
            todaySpend: 0,
            totalSpend: null as number | null,
            updatedAt: null as number | null,
            status: "error",
        };
    }
}

function timestampToMs(value: unknown) {
    if (!value) return null;
    if (typeof value === "number") return value;
    if (typeof value === "object" && value !== null && "toMillis" in value) {
        return (value as { toMillis: () => number }).toMillis();
    }
    return null;
}

function subscriptionDailyBudget(data: FirebaseFirestore.DocumentData) {
    const stored = Number(data.dailyBudget || data.metaDailyBudget || 0);
    if (Number.isFinite(stored) && stored > 0) return stored;
    return calculateAdsBudgetAllocation(Number(data.adsBudget || 0), Number(data.cycleDays || 5) || 5).dailyBudget;
}

async function listActiveCityPoolSubscriptions(cityId: string) {
    const snap = await adminDb
        .collection("subscriptions")
        .where("cityId", "==", cityId)
        .where("status", "in", CITY_POOL_PRESENT_SUBSCRIPTION_STATUSES)
        .limit(50)
        .get();

    return snap.docs;
}

async function syncSharedCityCampaignBudget(cityId: string) {
    const cityRef = adminDb.collection("cities").doc(cityId);
    const [citySnap, subscriptionDocs] = await Promise.all([
        cityRef.get(),
        listActiveCityPoolSubscriptions(cityId),
    ]);

    if (!citySnap.exists) throw new ResponseError("city_not_found", "La ciudad no existe.", 404);

    const city = citySnap.data() || {};
    const campaignId = String(city.activeCampaignId || city.campaignId || city.baseCampaignId || "");
    if (!campaignId) throw new ResponseError("campaign_required", "La ciudad no tiene campana Meta configurada.", 409);

    const poolSubscriptions = subscriptionDocs.map((doc) => ({ id: doc.id, data: doc.data() }));
    const activeSubscriptions = poolSubscriptions.filter((item) => CITY_POOL_ACTIVE_SUBSCRIPTION_STATUSES.includes(String(item.data.status)));
    const ownerUserIds = Array.from(new Set(poolSubscriptions.map((item) => String(item.data.userId || "")).filter(Boolean)));
    const subscriptionIds = poolSubscriptions.map((item) => item.id);

    if (poolSubscriptions.length === 0) {
        const adsetIds = Array.isArray(city.adsetIds) ? city.adsetIds.map((id) => String(id)).filter(Boolean) : [];
        await pauseCityCampaign({ campaignId, adsetIds }).catch(() => undefined);
        await cityRef.set(
            {
                status: "available",
                ownerUserId: null,
                ownerUserIds: [],
                activeSubscriptionId: FieldValue.delete(),
                activeSubscriptionIds: [],
                activeParticipantsCount: 0,
                activeCampaignId: FieldValue.delete(),
                campaignDeliveryStatus: FieldValue.delete(),
                campaignDeliveryUpdatedAt: FieldValue.delete(),
                sharedPoolDailyBudget: FieldValue.delete(),
                sharedPoolTargetSpend: FieldValue.delete(),
                updatedAt: nowMs(),
            },
            { merge: true },
        );
        return null;
    }

    if (activeSubscriptions.length === 0) {
        const adsetIds = Array.isArray(city.adsetIds) ? city.adsetIds.map((id) => String(id)).filter(Boolean) : [];
        const result = await pauseCityCampaign({ campaignId, adsetIds });
        await cityRef.set(
            {
                status: "occupied",
                ownerUserId: ownerUserIds[0] || null,
                ownerUserIds,
                activeSubscriptionId: subscriptionIds[0],
                activeSubscriptionIds: subscriptionIds,
                activeParticipantsCount: 0,
                pausedParticipantsCount: poolSubscriptions.length,
                activeCampaignId: result.campaignId,
                campaignDeliveryStatus: "paused",
                campaignDeliveryUpdatedAt: nowMs(),
                adsetIds: result.adsetIds,
                sharedPoolDailyBudget: 0,
                sharedPoolTargetSpend: 0,
                updatedAt: nowMs(),
            },
            { merge: true },
        );
        return {
            campaignId: result.campaignId,
            adsetIds: result.adsetIds,
            adIds: Array.isArray(city.adIds) ? city.adIds : [],
            dailyBudget: 0,
            targetSpend: 0,
            participantCount: 0,
            subscriptionIds,
            status: "PAUSED",
        };
    }

    const dailyBudget = Math.round(activeSubscriptions.reduce((sum, item) => sum + subscriptionDailyBudget(item.data), 0) * 100) / 100;
    const targetSpend = Math.round(activeSubscriptions.reduce((sum, item) => sum + Number(item.data.targetSpend || item.data.adsBudget || 0), 0) * 100) / 100;
    const existingAdsetIds = Array.isArray(city.adsetIds) ? city.adsetIds.map((id) => String(id)).filter(Boolean) : [];
    const baselineCandidates = poolSubscriptions
        .map((item) => Number(item.data.spendBaseline || item.data.metaSpendBaseline || 0))
        .filter((value) => Number.isFinite(value) && value >= 0);
    const existingBaseline = Number(city.sharedPoolSpendBaseline);
    const spendBaseline = Number.isFinite(existingBaseline) && existingBaseline > 0
        ? existingBaseline
        : (baselineCandidates.length ? Math.min(...baselineCandidates) : 0);

    const campaign = await updateCityCampaignDailyBudget({
        campaignId,
        adsetIds: existingAdsetIds,
        dailyBudget,
        status: "ACTIVE",
    });

    await cityRef.set(
        {
            status: "occupied",
            ownerUserId: ownerUserIds[0] || null,
            ownerUserIds,
            activeSubscriptionId: subscriptionIds[0],
            activeSubscriptionIds: subscriptionIds,
            activeParticipantsCount: activeSubscriptions.length,
            pausedParticipantsCount: poolSubscriptions.length - activeSubscriptions.length,
            activeCampaignId: campaign.campaignId,
            campaignDeliveryStatus: "active",
            campaignDeliveryUpdatedAt: nowMs(),
            adsetIds: campaign.adsetIds,
            adIds: campaign.adIds,
            sharedPoolDailyBudget: campaign.dailyBudget,
            sharedPoolTargetSpend: targetSpend,
            sharedPoolSpendBaseline: spendBaseline,
            updatedAt: nowMs(),
        },
        { merge: true },
    );

    return { ...campaign, targetSpend, participantCount: activeSubscriptions.length, subscriptionIds };
}

export async function saveSubscriptionCity(input: {
    id?: string;
    name: string;
    state?: string;
    country?: string;
    status?: string;
    campaignId: string;
}) {
    const name = input.name.trim();
    const campaignId = input.campaignId.trim();
    const status = input.status || "available";

    if (!name) throw new ResponseError("city_name_required", "El nombre de la ciudad es obligatorio.");
    if (!campaignId) {
        throw new ResponseError("campaign_required", "El ID de campana Meta es obligatorio.");
    }
    if (!["available", "reserved", "occupied"].includes(status)) {
        throw new ResponseError("invalid_city_status", "Estado de ciudad invalido.");
    }

    const id = normalizeCityId(input.id || name);
    if (!id) throw new ResponseError("city_id_required", "El ID interno de la ciudad es obligatorio.");
    const cityRef = adminDb.collection("cities").doc(id);
    const snap = await cityRef.get();
    const existing = snap.data() || {};

    await cityRef.set(
        {
            name,
            state: input.state?.trim() || null,
            country: input.country?.trim() || null,
            status,
            ownerUserId: status === "available" ? null : existing.ownerUserId || null,
            campaignId,
            baseCampaignId: FieldValue.delete(),
            updatedAt: nowMs(),
            createdAt: existing.createdAt || nowMs(),
        },
        { merge: true },
    );

    const updated = await cityRef.get();
    return {
        id: cityRef.id,
        ...updated.data(),
    };
}

export async function saveCityNote(cityId: string, note: string | null) {
    const id = cityId.trim();
    if (!id) throw new ResponseError("city_required", "Indica la ciudad.");
    const cityRef = adminDb.collection("cities").doc(id);
    const clean = note ? note.trim().slice(0, 500) : null;
    await cityRef.set(
        { note: clean ?? FieldValue.delete(), updatedAt: nowMs() },
        { merge: true },
    );
}

export async function deleteSubscriptionCity(cityId: string) {
    const cleanCityId = cityId.trim();
    if (!cleanCityId) {
        throw new ResponseError("city_required", "Indica la ciudad a eliminar.");
    }

    const cityRef = adminDb.collection("cities").doc(cleanCityId);
    await adminDb.runTransaction(async (tx) => {
        const citySnap = await tx.get(cityRef);
        if (!citySnap.exists) throw new ResponseError("city_not_found", "La ciudad no existe.", 404);

        const city = citySnap.data() || {};
        const status = String(city.status || "available");
        const activeSubscriptionId = String(city.activeSubscriptionId || "");
        const reservedCheckoutId = String(city.reservedByCheckoutId || "");

        if (status !== "available" || activeSubscriptionId || reservedCheckoutId) {
            throw new ResponseError(
                "city_not_available_for_delete",
                "Primero libera la ciudad. Solo se pueden eliminar ciudades libres y sin reservas activas.",
                409,
            );
        }

        tx.delete(cityRef);
    });

    return { ok: true, cityId: cleanCityId };
}

function normalizeCityId(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

function normalizeCoverageText(value: unknown) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

type CoverageItem = {
    type?: unknown;
    countryLabel?: unknown;
    countryNormalized?: unknown;
    stateLabel?: unknown;
    stateNormalized?: unknown;
    cityLabel?: unknown;
    cityNormalized?: unknown;
    active?: unknown;
};

function cityMatchesCoverage(city: { id: string; name?: unknown; state?: unknown; country?: unknown }, coverage: CoverageItem[]) {
    const activeCoverage = coverage.filter((item) => item && item.active !== false);
    if (!activeCoverage.length) return false;

    const cityName = normalizeCoverageText(city.name || city.id);
    const cityId = normalizeCoverageText(city.id);
    const cityState = normalizeCoverageText(city.state);
    const cityCountry = normalizeCoverageText(city.country || "Brasil");

    return activeCoverage.some((item) => {
        const type = String(item.type || "city");
        const coverageCountry = normalizeCoverageText(item.countryNormalized || item.countryLabel || "Brasil");
        const coverageState = normalizeCoverageText(item.stateNormalized || item.stateLabel);
        const coverageCity = normalizeCoverageText(item.cityNormalized || item.cityLabel);

        if (type === "country") {
            return Boolean(coverageCountry) && coverageCountry === cityCountry;
        }

        if (type === "state") {
            if (!coverageState || coverageState !== cityState) return false;
            return !coverageCountry || coverageCountry === cityCountry;
        }

        if (!coverageCity || (coverageCity !== cityName && coverageCity !== cityId)) return false;
        if (coverageState && cityState && coverageState !== cityState) return false;
        if (coverageCountry && cityCountry && coverageCountry !== cityCountry) return false;
        return true;
    });
}

async function getUserGeoCoverage(userId: string) {
    const snap = await adminDb.collection("users").doc(userId).get();
    const data = snap.data() || {};
    return Array.isArray(data.geoCoverage) ? (data.geoCoverage as CoverageItem[]) : [];
}

export async function createPixSubscriptionCheckout(input: {
    userId: string;
    cityId: string;
    plan: SubscriptionPlanId;
    customAmount?: number;
    email: string;
    notificationUrl: string;
}): Promise<PixCheckoutResponse> {
    const checkoutId = randomUUID();
    const amount = getPlanAmount(input.plan, input.customAmount);
    const settings = await getSubscriptionSettings();
    const adsBudget = calculateAdsBudget(amount, settings.adsShare);
    const budgetAllocation = calculateAdsBudgetAllocation(adsBudget, settings.cycleDays);
    const checkoutRef = adminDb.collection("subscriptionCheckouts").doc(checkoutId);
    const cityRef = adminDb.collection("cities").doc(input.cityId);
    const reservationExpiresAt = nowMs() + RESERVATION_TTL_MS;

    const cityData = await adminDb.runTransaction(async (tx) => {
        const activeSubscriptionSnap = await tx.get(
            adminDb
                .collection("subscriptions")
                .where("userId", "==", input.userId)
                .where("status", "in", USER_BLOCKING_SUBSCRIPTION_STATUSES)
                .limit(1),
        );
        if (!activeSubscriptionSnap.empty) {
            throw new ResponseError(
                "active_subscription_exists",
                "Ya tienes una suscripcion activa o en activacion.",
                409,
            );
        }

        const citySnap = await tx.get(cityRef);
        if (!citySnap.exists) {
            throw new ResponseError("city_not_found", "La ciudad seleccionada no existe.", 404);
        }

        const city = citySnap.data() || {};
        const userSnap = await tx.get(adminDb.collection("users").doc(input.userId));
        const userData = userSnap.data() || {};
        const userCoverage = Array.isArray(userData.geoCoverage) ? (userData.geoCoverage as CoverageItem[]) : [];
        if (!cityMatchesCoverage({ id: citySnap.id, name: city.name, state: city.state, country: city.country }, userCoverage)) {
            throw new ResponseError(
                "city_outside_coverage",
                "Esta ciudad no esta habilitada en tu cobertura geografica.",
                403,
            );
        }

        const cityStatus = city.status || "available";
        const currentReservationExpiresAt = Number(city.reservationExpiresAt || 0);
        const reservedByThisCheckout = city.reservedByCheckoutId === checkoutId;
        const reservationExpired = cityStatus === "reserved" && currentReservationExpiresAt < nowMs();

        if (cityStatus === "occupied") {
            const ownerIds = Array.isArray(city.ownerUserIds) ? city.ownerUserIds.map((id) => String(id)) : [];
            if (city.ownerUserId === input.userId || ownerIds.includes(input.userId)) {
                throw new ResponseError("city_already_active_for_you", "Ya tienes una suscripcion activa para esta ciudad.", 409);
            }
        }

        if (cityStatus === "reserved" && !reservationExpired && !reservedByThisCheckout) {
            if (typeof city.reservedByCheckoutId === "string" && city.reservedByCheckoutId) {
                const reservedCheckout = await tx.get(adminDb.collection("subscriptionCheckouts").doc(city.reservedByCheckoutId));
                const reservedData = reservedCheckout.data() || {};
                if (reservedData.userId === input.userId) {
                    throw new ResponseError(
                        "city_reserved_by_you",
                        "Ya tienes un Pix pendiente para esta ciudad. Puedes usarlo o esperar a que la reserva expire.",
                        409,
                    );
                }
            }
            throw new ResponseError("city_reserved", "Esta ciudad esta reservada por un pago en curso.", 409);
        }

        const campaignId = city.campaignId || city.baseCampaignId;
        if (!campaignId || typeof campaignId !== "string") {
            throw new ResponseError(
                "city_missing_campaign",
                "Esta ciudad no tiene campana Meta configurada.",
                409,
            );
        }

        const cityName = String(city.name || citySnap.id);
        tx.set(checkoutRef, {
            id: checkoutId,
            userId: input.userId,
            cityId: input.cityId,
            cityName,
            plan: input.plan,
            amount,
            adsBudget,
            dailyBudget: budgetAllocation.dailyBudget,
            operatingBudget: budgetAllocation.operatingBudget,
            reservedBudget: budgetAllocation.reservedBudget,
            totalBudget: budgetAllocation.totalBudget,
            reservePercent: budgetAllocation.reservePercent,
            targetSpend: budgetAllocation.totalBudget,
            spendPauseThreshold: Math.round(budgetAllocation.totalBudget * 0.98 * 100) / 100,
            adsShare: settings.adsShare,
            cycleDays: settings.cycleDays,
            paymentId: "",
            status: "pending",
            activationStatus: "waiting_payment",
            sharedPool: cityStatus === "occupied",
            createdAt: nowMs(),
            updatedAt: nowMs(),
        });

        if (cityStatus !== "occupied") {
            tx.set(
                cityRef,
                {
                    status: "reserved",
                    reservedByCheckoutId: checkoutId,
                    reservationExpiresAt,
                    updatedAt: nowMs(),
                },
                { merge: true },
            );
        }

        return {
            name: cityName,
            campaignId,
        };
    });

    let payment;
    try {
        payment = await createPixPayment({
            checkoutId,
            userId: input.userId,
            cityId: input.cityId,
            cityName: cityData.name,
            plan: input.plan,
            amount,
            email: input.email,
            notificationUrl: input.notificationUrl,
        });
    } catch (error) {
        await Promise.all([
            checkoutRef.set(
                {
                    status: "failed",
                    activationStatus: "waiting_payment",
                    failureReason: error instanceof Error ? error.message : "pix_creation_failed",
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            cityRef.set(
                {
                    status: "available",
                    reservedByCheckoutId: FieldValue.delete(),
                    reservationExpiresAt: FieldValue.delete(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
        ]);
        throw error;
    }

    await checkoutRef.set(
        {
            paymentId: String(payment.id),
            qrCode: payment.point_of_interaction?.transaction_data?.qr_code || "",
            qrCodeBase64: payment.point_of_interaction?.transaction_data?.qr_code_base64 || "",
            ticketUrl: payment.point_of_interaction?.transaction_data?.ticket_url || null,
            expiresAt: payment.date_of_expiration || null,
            updatedAt: nowMs(),
        },
        { merge: true },
    );

    return {
        checkoutId,
        paymentId: String(payment.id),
        status: "pending",
        qrCode: payment.point_of_interaction?.transaction_data?.qr_code || "",
        qrCodeBase64: payment.point_of_interaction?.transaction_data?.qr_code_base64 || "",
        ticketUrl: payment.point_of_interaction?.transaction_data?.ticket_url || null,
        expiresAt: payment.date_of_expiration || null,
    };
}

export async function activateManualSubscription(input: {
    userId: string;
    cityId: string;
    plan: SubscriptionPlanId;
    customAmount?: number;
    cycleDays?: number;
    syncMeta?: boolean;
    createdBy: string;
    createdByName?: string;
}) {
    const userId = input.userId.trim();
    const cityId = input.cityId.trim();
    if (!userId) throw new ResponseError("user_required", "Selecciona un vendedor.");
    if (!cityId) throw new ResponseError("city_required", "Selecciona una ciudad.");

    const amount = getPlanAmount(input.plan, input.customAmount);
    const settings = await getSubscriptionSettings();
    let cycleDays = Number.isFinite(Number(input.cycleDays))
        ? Math.min(Math.max(Math.round(Number(input.cycleDays)), 1), 30)
        : settings.cycleDays;
    const adsBudget = calculateAdsBudget(amount, settings.adsShare);
    let campaignActivation: Awaited<ReturnType<typeof configureAndActivateCityCampaign>> | null = null;

    if (input.syncMeta !== false) {
        const [userSnap, citySnap, activeSubscriptionSnap] = await Promise.all([
            adminDb.collection("users").doc(userId).get(),
            adminDb.collection("cities").doc(cityId).get(),
            adminDb
                .collection("subscriptions")
                .where("userId", "==", userId)
                .where("status", "in", USER_BLOCKING_SUBSCRIPTION_STATUSES)
                .limit(1)
                .get(),
        ]);
        if (!userSnap.exists) throw new ResponseError("user_not_found", "El vendedor no existe.", 404);
        if (!citySnap.exists) throw new ResponseError("city_not_found", "La ciudad seleccionada no existe.", 404);
        if (!activeSubscriptionSnap.empty) {
            throw new ResponseError(
                "active_subscription_exists",
                "Este vendedor ya tiene una suscripcion activa o en activacion.",
                409,
            );
        }
        const user = userSnap.data() || {};
        const city = citySnap.data() || {};
        if (user.role !== "user") {
            throw new ResponseError("invalid_user_role", "Solo puedes activar suscripciones a vendedores.", 409);
        }
        if (user.active === false) {
            throw new ResponseError("inactive_user", "El vendedor esta inactivo.", 409);
        }
        const coverage = Array.isArray(user.geoCoverage) ? (user.geoCoverage as CoverageItem[]) : [];
        if (!cityMatchesCoverage({ id: citySnap.id, name: city.name, state: city.state, country: city.country }, coverage)) {
            throw new ResponseError(
                "city_outside_coverage",
                "Esta ciudad no esta dentro de la cobertura geografica del vendedor.",
                403,
            );
        }
        const cityStatus = String(city.status || "available");
        const reservationExpiresAt = Number(city.reservationExpiresAt || 0);
        const reservationExpired = cityStatus === "reserved" && reservationExpiresAt < nowMs();
        if (cityStatus === "occupied") {
            const ownerIds = Array.isArray(city.ownerUserIds) ? city.ownerUserIds.map((id) => String(id)) : [];
            if (city.ownerUserId === userId || ownerIds.includes(userId)) {
                throw new ResponseError("city_already_active_for_user", "Este vendedor ya participa en esta ciudad.", 409);
            }
        }
        if (cityStatus === "reserved" && !reservationExpired) {
            throw new ResponseError("city_reserved", "Esta ciudad esta reservada por un pago en curso.", 409);
        }
        const campaignId = String(city.campaignId || city.baseCampaignId || city.activeCampaignId || "");
        if (!campaignId) {
            throw new ResponseError("campaign_required", "La ciudad no tiene campana Meta para activar.", 409);
        }
        if (cityStatus !== "occupied") {
            campaignActivation = await configureAndActivateCityCampaign({
                campaignId,
                cityName: String(city.name || cityId),
                userId,
                adsBudget,
                cycleDays,
            });
        }
    }

    const budgetAllocation = calculateAdsBudgetAllocation(adsBudget, cycleDays);
    const spendPauseThreshold = Math.round(budgetAllocation.totalBudget * 0.98 * 100) / 100;
    const startDate = campaignActivation?.startDate ?? new Date();
    const endDate = campaignActivation?.endDate ?? calculateCycleEnd(startDate, cycleDays);
    const dailyBudget = campaignActivation?.dailyBudget ?? budgetAllocation.dailyBudget;
    const operatingBudget = campaignActivation?.operatingBudget ?? budgetAllocation.operatingBudget;
    const reservedBudget = campaignActivation?.reservedBudget ?? budgetAllocation.reservedBudget;
    const totalBudget = campaignActivation?.totalBudget ?? budgetAllocation.totalBudget;
    const targetSpend = campaignActivation?.targetSpend ?? totalBudget;
    const activationSpendPauseThreshold = campaignActivation?.spendPauseThreshold ?? spendPauseThreshold;
    const subscriptionId = `manual_${userId}_${cityId}_${randomUUID()}`;
    const subscriptionRef = adminDb.collection("subscriptions").doc(subscriptionId);
    const cityRef = adminDb.collection("cities").doc(cityId);
    const userRef = adminDb.collection("users").doc(userId);

    const result = await adminDb.runTransaction(async (tx) => {
        const [userSnap, citySnap, activeSubscriptionSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(cityRef),
            tx.get(
                adminDb
                    .collection("subscriptions")
                    .where("userId", "==", userId)
                    .where("status", "in", USER_BLOCKING_SUBSCRIPTION_STATUSES)
                    .limit(1),
            ),
        ]);

        if (!userSnap.exists) throw new ResponseError("user_not_found", "El vendedor no existe.", 404);
        if (!citySnap.exists) throw new ResponseError("city_not_found", "La ciudad seleccionada no existe.", 404);
        if (!activeSubscriptionSnap.empty) {
            throw new ResponseError(
                "active_subscription_exists",
                "Este vendedor ya tiene una suscripcion activa o en activacion.",
                409,
            );
        }

        const user = userSnap.data() || {};
        if (user.role !== "user") {
            throw new ResponseError("invalid_user_role", "Solo puedes activar suscripciones a vendedores.", 409);
        }
        if (user.active === false) {
            throw new ResponseError("inactive_user", "El vendedor esta inactivo.", 409);
        }

        const city = citySnap.data() || {};
        const coverage = Array.isArray(user.geoCoverage) ? (user.geoCoverage as CoverageItem[]) : [];
        if (!cityMatchesCoverage({ id: citySnap.id, name: city.name, state: city.state, country: city.country }, coverage)) {
            throw new ResponseError(
                "city_outside_coverage",
                "Esta ciudad no esta dentro de la cobertura geografica del vendedor.",
                403,
            );
        }

        const cityStatus = String(city.status || "available");
        const reservationExpiresAt = Number(city.reservationExpiresAt || 0);
        const reservationExpired = cityStatus === "reserved" && reservationExpiresAt < nowMs();
        if (cityStatus === "occupied") {
            const ownerIds = Array.isArray(city.ownerUserIds) ? city.ownerUserIds.map((id) => String(id)) : [];
            if (city.ownerUserId === userId || ownerIds.includes(userId)) {
                throw new ResponseError("city_already_active_for_user", "Este vendedor ya participa en esta ciudad.", 409);
            }
        }
        if (cityStatus === "reserved" && !reservationExpired) {
            throw new ResponseError("city_reserved", "Esta ciudad esta reservada por un pago en curso.", 409);
        }

        const userName = String(user.name || user.email || "Vendedor");
        const userEmail = String(user.email || "");
        const cityName = String(city.name || citySnap.id);
        const now = nowMs();

        tx.set(subscriptionRef, {
            id: subscriptionId,
            checkoutId: null,
            userId,
            userName,
            userEmail,
            cityId,
            city: cityName,
            plan: input.plan,
            amount,
            adsBudget,
            dailyBudget,
            operatingBudget,
            reservedBudget,
            totalBudget,
            lifetimeBudget: campaignActivation?.lifetimeBudget ?? null,
            budgetMode: campaignActivation?.budgetMode ?? "manual",
            reservePercent: campaignActivation?.reservePercent ?? budgetAllocation.reservePercent,
            targetSpend,
            spendPauseThreshold: activationSpendPauseThreshold,
            spendBaseline: campaignActivation?.spendBaseline ?? 0,
            cycleSpend: 0,
            lastSpendCheckedAt: now,
            adsShare: settings.adsShare,
            cycleDays,
            status: "active",
            source: "manual_admin",
            manual: true,
            sharedPool: cityStatus === "occupied",
            metaManagedManually: Boolean(campaignActivation),
            campaignId: campaignActivation?.campaignId || String(city.activeCampaignId || city.campaignId || city.baseCampaignId || "") || null,
            adsetIds: campaignActivation?.adsetIds || [],
            adIds: campaignActivation?.adIds || [],
            metaDailyBudget: campaignActivation?.dailyBudget ?? null,
            metaSpendBaseline: campaignActivation?.spendBaseline ?? null,
            createdBy: input.createdBy,
            createdByName: input.createdByName || input.createdBy,
            startDate: Timestamp.fromDate(startDate),
            endDate: Timestamp.fromDate(endDate),
            createdAt: now,
            updatedAt: now,
        });

        tx.set(
            cityRef,
            {
                status: "occupied",
                ownerUserId: city.ownerUserId || userId,
                ownerUserIds: Array.from(new Set([...(Array.isArray(city.ownerUserIds) ? city.ownerUserIds.map((id) => String(id)) : []), String(city.ownerUserId || ""), userId].filter(Boolean))),
                activeSubscriptionId: subscriptionId,
                activeSubscriptionIds: Array.from(new Set([...(Array.isArray(city.activeSubscriptionIds) ? city.activeSubscriptionIds.map((id) => String(id)) : []), String(city.activeSubscriptionId || ""), subscriptionId].filter(Boolean))),
                activeParticipantsCount: FieldValue.increment(1),
                activeCampaignId: campaignActivation?.campaignId || String(city.activeCampaignId || city.campaignId || city.baseCampaignId || "") || FieldValue.delete(),
                campaignDeliveryStatus: campaignActivation ? "active" : city.campaignDeliveryStatus || FieldValue.delete(),
                adsetIds: campaignActivation?.adsetIds || (Array.isArray(city.adsetIds) ? city.adsetIds : FieldValue.delete()),
                adIds: campaignActivation?.adIds || (Array.isArray(city.adIds) ? city.adIds : FieldValue.delete()),
                reservedByCheckoutId: FieldValue.delete(),
                reservationExpiresAt: FieldValue.delete(),
                updatedAt: now,
            },
            { merge: true },
        );

        return {
            id: subscriptionId,
            userId,
            userName,
            userEmail,
            cityId,
            city: cityName,
            plan: input.plan,
            amount,
            adsBudget,
            status: "active",
            startDate: startDate.getTime(),
            endDate: endDate.getTime(),
            createdAt: now,
            updatedAt: now,
            source: "manual_admin",
            campaignId: campaignActivation?.campaignId || null,
        };
    });

    if (input.syncMeta !== false) {
        if (result.campaignId) {
            const spendBaseline = await getMetaCampaignTotalSpend(result.campaignId).catch(() => 0);
            await subscriptionRef.set(
                {
                    spendBaseline,
                    metaSpendBaseline: spendBaseline,
                    lastSpendCheckedAt: nowMs(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            );
        }
        await syncSharedCityCampaignBudget(cityId);
    }

    await sendPushToUser(userId, {
        title: "Suscripcion activa",
        body: `TrackGo activo manualmente tu suscripcion para ${result.city}.`,
    }, { url: "/user/settings/subscriptions" }).catch(() => undefined);

    return { ok: true, subscription: result };
}

export async function getUserSubscriptionPortal(userId: string) {
    const [cities, settings, subscriptionsSnap, checkoutsSnap, userCoverage] = await Promise.all([
        listSubscriptionCities(),
        getSubscriptionSettings(),
        adminDb
            .collection("subscriptions")
            .where("userId", "==", userId)
            .limit(10)
            .get(),
        adminDb
            .collection("subscriptionCheckouts")
            .where("userId", "==", userId)
            .limit(10)
            .get(),
        getUserGeoCoverage(userId),
    ]);
    const coveredCities = cities.filter((city) => cityMatchesCoverage(city, userCoverage));

    return {
        settings,
        cities: coveredCities,
        subscriptions: subscriptionsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                cityId: data.cityId || null,
                city: data.city || null,
                plan: data.plan || null,
                amount: Number(data.amount || 0),
                adsBudget: Number(data.adsBudget || 0),
                status: data.status || "unknown",
                campaignId: data.campaignId || null,
                startDate: timestampToMs(data.startDate),
                endDate: timestampToMs(data.endDate),
                updatedAt: Number(data.updatedAt || 0) || null,
            };
        }).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
        checkouts: checkoutsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                cityId: data.cityId || null,
                cityName: data.cityName || null,
                plan: data.plan || null,
                amount: Number(data.amount || 0),
                adsBudget: Number(data.adsBudget || 0),
                paymentId: data.paymentId || "",
                status: data.status || "unknown",
                activationStatus: data.activationStatus || "unknown",
                qrCode: data.qrCode || "",
                qrCodeBase64: data.qrCodeBase64 || "",
                ticketUrl: data.ticketUrl || null,
                expiresAt: data.expiresAt || null,
                failureReason: data.failureReason || null,
                hiddenFromUser: data.hiddenFromUser === true,
                createdAt: Number(data.createdAt || 0) || null,
                updatedAt: Number(data.updatedAt || 0) || null,
                paymentApprovedAt: Number(data.paymentApprovedAt || 0) || null,
            };
        }).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    };
}

export async function processMercadoPagoPayment(paymentId: string) {
    const payment = await getMercadoPagoPayment(paymentId);
    if (payment.status !== "approved") {
        return {
            ok: true,
            ignored: true,
            status: payment.status,
        };
    }

    const checkoutId =
        typeof payment.metadata?.checkoutId === "string"
            ? payment.metadata.checkoutId
            : payment.external_reference;

    if (!checkoutId) {
        throw new ResponseError("checkout_missing", "El pago no tiene checkout asociado.", 400);
    }

    const checkoutRef = adminDb.collection("subscriptionCheckouts").doc(checkoutId);
    const checkoutSnap = await checkoutRef.get();
    if (!checkoutSnap.exists) {
        throw new ResponseError("checkout_not_found", "No existe el checkout del pago.", 404);
    }

    const checkout = checkoutSnap.data() || {};
    if (checkout.status === "approved" && checkout.activationStatus === "active") {
        return {
            ok: true,
            idempotent: true,
            checkoutId,
        };
    }

    if (checkout.status === "cancelled" || checkout.activationStatus === "city_released") {
        return {
            ok: true,
            ignored: true,
            checkoutId,
            status: "checkout_cancelled",
        };
    }

    const expectedAmount = Number(checkout.amount || 0);
    if (Math.abs(Number(payment.transaction_amount) - expectedAmount) > 0.01) {
        await checkoutRef.set(
            {
                status: "failed",
                activationStatus: "city_occupied",
                failureReason: "amount_mismatch",
                updatedAt: nowMs(),
            },
            { merge: true },
        );
        throw new ResponseError("amount_mismatch", "El monto pagado no coincide con el checkout.", 409);
    }

    const cityRef = adminDb.collection("cities").doc(String(checkout.cityId));
    const subscriptionRef = adminDb.collection("subscriptions").doc(checkoutId);

    const transactionResult = await adminDb.runTransaction(async (tx) => {
        const [freshCheckoutSnap, citySnap] = await Promise.all([tx.get(checkoutRef), tx.get(cityRef)]);
        const freshCheckout = freshCheckoutSnap.data() || {};
        const city = citySnap.data() || {};

        if (freshCheckout.status === "approved" && freshCheckout.activationStatus === "active") {
            return { idempotent: true, city };
        }

        if (!citySnap.exists) {
            throw new ResponseError("city_not_found", "La ciudad asociada al checkout no existe.", 404);
        }

        if (city.status === "occupied") {
            const ownerIds = Array.isArray(city.ownerUserIds) ? city.ownerUserIds.map((id) => String(id)) : [];
            if (city.ownerUserId === freshCheckout.userId || ownerIds.includes(freshCheckout.userId)) {
                tx.set(
                    checkoutRef,
                    {
                        status: "approved",
                        activationStatus: "city_occupied",
                        updatedAt: nowMs(),
                    },
                    { merge: true },
                );
                throw new ResponseError("city_already_active_after_payment", "Este usuario ya tiene activa esta ciudad.", 409);
            }
        }

        tx.set(
            checkoutRef,
            {
                status: "approved",
                activationStatus: "processing",
                paymentApprovedAt: nowMs(),
                updatedAt: nowMs(),
            },
            { merge: true },
        );

        tx.set(
            cityRef,
            {
                status: "occupied",
                ownerUserId: city.ownerUserId || freshCheckout.userId,
                ownerUserIds: Array.from(new Set([...(Array.isArray(city.ownerUserIds) ? city.ownerUserIds.map((id) => String(id)) : []), String(city.ownerUserId || ""), String(freshCheckout.userId || "")].filter(Boolean))),
                reservedByCheckoutId: FieldValue.delete(),
                reservationExpiresAt: FieldValue.delete(),
                updatedAt: nowMs(),
            },
            { merge: true },
        );

        const startDate = new Date();
        const cycleDays = Number(freshCheckout.cycleDays || 5) || 5;
        tx.set(subscriptionRef, {
            id: checkoutId,
            checkoutId,
            userId: freshCheckout.userId,
            cityId: freshCheckout.cityId,
            city: freshCheckout.cityName,
            plan: freshCheckout.plan,
            amount: freshCheckout.amount,
            adsBudget: freshCheckout.adsBudget,
            targetSpend: freshCheckout.targetSpend || freshCheckout.adsBudget,
            spendPauseThreshold: freshCheckout.spendPauseThreshold || Math.round(Number(freshCheckout.adsBudget || 0) * 0.98 * 100) / 100,
            status: "provisioning",
            startDate: Timestamp.fromDate(startDate),
            endDate: Timestamp.fromDate(calculateCycleEnd(startDate, cycleDays)),
            adsShare: Number(freshCheckout.adsShare ?? 0.5),
            cycleDays,
            createdAt: nowMs(),
            updatedAt: nowMs(),
        });

        return { idempotent: false, city };
    });

    if (transactionResult.idempotent) {
        return { ok: true, idempotent: true, checkoutId };
    }

    try {
        const campaignId = String(transactionResult.city.activeCampaignId || transactionResult.city.campaignId || transactionResult.city.baseCampaignId);
        const spendBaseline = await getMetaCampaignTotalSpend(campaignId).catch(() => 0);
        await subscriptionRef.set(
            {
                campaignId,
                spendBaseline,
                metaSpendBaseline: spendBaseline,
                lastSpendCheckedAt: nowMs(),
                updatedAt: nowMs(),
            },
            { merge: true },
        );
        const campaign = await syncSharedCityCampaignBudget(String(checkout.cityId));
        if (!campaign) throw new ResponseError("campaign_sync_failed", "No se pudo sincronizar la bolsa compartida.", 409);

        await Promise.all([
            subscriptionRef.set(
                {
                    status: "active",
                    campaignId: campaign.campaignId,
                    adsetIds: campaign.adsetIds,
                    adIds: campaign.adIds,
                    sharedPool: campaign.participantCount > 1,
                    sharedPoolDailyBudget: campaign.dailyBudget,
                    sharedPoolTargetSpend: campaign.targetSpend,
                    budgetMode: "daily",
                    spendBaseline,
                    cycleSpend: 0,
                    lastSpendCheckedAt: nowMs(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            checkoutRef.set(
                {
                    activationStatus: "active",
                    campaignId: campaign.campaignId,
                    sharedPool: campaign.participantCount > 1,
                    sharedPoolDailyBudget: campaign.dailyBudget,
                    sharedPoolTargetSpend: campaign.targetSpend,
                    spendBaseline,
                    cycleSpend: 0,
                    lastSpendCheckedAt: nowMs(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
        ]);

        sendPushToUser(
            String(checkout.userId),
            {
                title: "Tu zona está activa",
                body: `${checkout.cityName} ya está lista. Empezarás a recibir clientes en breve.`,
            },
        ).catch(() => {});
    } catch (error) {
        await Promise.all([
            checkoutRef.set(
                {
                    activationStatus: "meta_failed",
                    failureReason: error instanceof Error ? error.message : "meta_failed",
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            subscriptionRef.set(
                {
                    status: "payment_approved_meta_failed",
                    failureReason: error instanceof Error ? error.message : "meta_failed",
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
        ]);
        throw error;
    }

    return {
        ok: true,
        checkoutId,
    };
}

export async function cancelPendingSubscriptionCheckout(input: { checkoutId: string; userId: string }) {
    const checkoutId = input.checkoutId.trim();
    if (!checkoutId) throw new ResponseError("checkout_required", "Indica el Pix pendiente a cancelar.");

    const checkoutRef = adminDb.collection("subscriptionCheckouts").doc(checkoutId);
    const checkoutSnap = await checkoutRef.get();
    if (!checkoutSnap.exists) {
        throw new ResponseError("checkout_not_found", "No existe el checkout.", 404);
    }

    const checkout = checkoutSnap.data() || {};
    if (String(checkout.userId || "") !== input.userId) {
        throw new ResponseError("checkout_forbidden", "No puedes cancelar este Pix.", 403);
    }

    if (checkout.status === "cancelled" || checkout.activationStatus === "city_released") {
        return { ok: true, idempotent: true, checkoutId };
    }

    if (checkout.status !== "pending") {
        throw new ResponseError("checkout_not_pending", "Solo puedes cancelar un Pix que todavia esta pendiente.", 409);
    }

    const paymentId = String(checkout.paymentId || "");
    if (paymentId) {
        const payment = await getMercadoPagoPayment(paymentId);
        if (payment.status === "approved") {
            throw new ResponseError("pix_already_paid", "Este Pix ya fue pagado y no se puede cancelar desde aqui.", 409);
        }

        if (["pending", "in_process", "authorized"].includes(payment.status)) {
            await cancelMercadoPagoPayment(paymentId);
        }
    }

    const cityRef = adminDb.collection("cities").doc(String(checkout.cityId || ""));

    await adminDb.runTransaction(async (tx) => {
        const [freshCheckoutSnap, citySnap] = await Promise.all([tx.get(checkoutRef), tx.get(cityRef)]);
        const freshCheckout = freshCheckoutSnap.data() || {};
        const city = citySnap.data() || {};

        if (freshCheckout.status === "cancelled" || freshCheckout.activationStatus === "city_released") return;
        if (freshCheckout.status !== "pending") {
            throw new ResponseError("checkout_not_pending", "Solo puedes cancelar un Pix que todavia esta pendiente.", 409);
        }

        tx.set(
            checkoutRef,
            {
                status: "cancelled",
                activationStatus: "city_released",
                cancelledAt: nowMs(),
                releasedAt: nowMs(),
                cancellationReason: "cancelled_by_user",
                failureReason: FieldValue.delete(),
                updatedAt: nowMs(),
            },
            { merge: true },
        );

        if (citySnap.exists && city.reservedByCheckoutId === checkoutId) {
            tx.set(
                cityRef,
                {
                    status: "available",
                    ownerUserId: null,
                    reservedByCheckoutId: FieldValue.delete(),
                    reservationExpiresAt: FieldValue.delete(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            );
        }
    });

    return { ok: true, checkoutId };
}

export async function retryMetaActivation(checkoutId: string) {
    const checkoutRef = adminDb.collection("subscriptionCheckouts").doc(checkoutId);
    const checkoutSnap = await checkoutRef.get();

    if (!checkoutSnap.exists) {
        throw new ResponseError("checkout_not_found", "No existe el checkout.", 404);
    }

    const checkout = checkoutSnap.data() || {};
    if (checkout.status !== "approved") {
        throw new ResponseError("checkout_not_approved", "Este checkout todavia no tiene pago aprobado.", 409);
    }

    if (checkout.activationStatus === "active") {
        return { ok: true, idempotent: true, checkoutId, campaignId: checkout.campaignId || null };
    }

    const cityRef = adminDb.collection("cities").doc(String(checkout.cityId || ""));
    const subscriptionRef = adminDb.collection("subscriptions").doc(checkoutId);
    const citySnap = await cityRef.get();

    if (!citySnap.exists) throw new ResponseError("city_not_found", "No existe la ciudad del checkout.", 404);

    const city = citySnap.data() || {};
    const campaignId = String(city.activeCampaignId || city.campaignId || city.baseCampaignId || "");
    if (!campaignId) {
        throw new ResponseError("campaign_required", "La ciudad no tiene campaignId configurado.");
    }

    await checkoutRef.set(
        {
            activationStatus: "processing",
            failureReason: FieldValue.delete(),
            updatedAt: nowMs(),
        },
        { merge: true },
    );

    try {
        const spendBaseline = await getMetaCampaignTotalSpend(campaignId).catch(() => 0);
        const cycleDays = Number(checkout.cycleDays || 5) || 5;
        const allocation = calculateAdsBudgetAllocation(Number(checkout.adsBudget || 0), cycleDays);
        await subscriptionRef.set(
            {
                id: checkoutId,
                checkoutId,
                userId: String(checkout.userId),
                cityId: String(checkout.cityId),
                city: String(checkout.cityName || city.name || checkout.cityId),
                plan: String(checkout.plan),
                amount: Number(checkout.amount || 0),
                adsBudget: Number(checkout.adsBudget || 0),
                adsShare: Number(checkout.adsShare ?? 0.5),
                cycleDays,
                status: "provisioning",
                campaignId,
                dailyBudget: allocation.dailyBudget,
                targetSpend: Number(checkout.targetSpend || checkout.adsBudget || 0),
                spendPauseThreshold: Number(checkout.spendPauseThreshold || Math.round(Number(checkout.adsBudget || 0) * 0.98 * 100) / 100),
                spendBaseline,
                metaSpendBaseline: spendBaseline,
                cycleSpend: 0,
                lastSpendCheckedAt: nowMs(),
                startDate: Timestamp.fromDate(new Date()),
                endDate: Timestamp.fromDate(calculateCycleEnd(new Date(), cycleDays)),
                updatedAt: nowMs(),
                createdAt: checkout.paymentApprovedAt || checkout.createdAt || nowMs(),
            },
            { merge: true },
        );
        const campaign = await syncSharedCityCampaignBudget(String(checkout.cityId));
        if (!campaign) throw new ResponseError("campaign_sync_failed", "No se pudo sincronizar la bolsa compartida.", 409);

        await Promise.all([
            subscriptionRef.set(
                {
                    status: "active",
                    campaignId: campaign.campaignId,
                    adsetIds: campaign.adsetIds,
                    adIds: campaign.adIds,
                    sharedPool: campaign.participantCount > 1,
                    sharedPoolDailyBudget: campaign.dailyBudget,
                    sharedPoolTargetSpend: campaign.targetSpend,
                    budgetMode: "daily",
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            checkoutRef.set(
                {
                    activationStatus: "active",
                    campaignId: campaign.campaignId,
                    sharedPool: campaign.participantCount > 1,
                    sharedPoolDailyBudget: campaign.dailyBudget,
                    sharedPoolTargetSpend: campaign.targetSpend,
                    spendBaseline,
                    cycleSpend: 0,
                    lastSpendCheckedAt: nowMs(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
        ]);

        sendPushToUser(
            String(checkout.userId),
            {
                title: "Tu zona está activa",
                body: `${checkout.cityName || checkout.cityId} ya está lista. Empezarás a recibir clientes en breve.`,
            },
        ).catch(() => {});

        return { ok: true, checkoutId, campaignId: campaign.campaignId };
    } catch (error) {
        await checkoutRef.set(
            {
                activationStatus: "meta_failed",
                failureReason: error instanceof Error ? error.message : "meta_failed",
                updatedAt: nowMs(),
            },
            { merge: true },
        );
        throw error;
    }
}

export async function hideCheckoutFromUser(checkoutId: string) {
    const checkoutRef = adminDb.collection("subscriptionCheckouts").doc(checkoutId.trim());
    const checkoutSnap = await checkoutRef.get();

    if (!checkoutSnap.exists) {
        throw new ResponseError("checkout_not_found", "No existe el checkout.", 404);
    }

    const checkout = checkoutSnap.data() || {};
    if (checkout.status !== "approved" || checkout.activationStatus !== "meta_failed") {
        throw new ResponseError("checkout_not_hideable", "Solo se puede ocultar un error de activacion pendiente.", 409);
    }

    await checkoutRef.set(
        {
            hiddenFromUser: true,
            hiddenFromUserAt: nowMs(),
            updatedAt: nowMs(),
        },
        { merge: true },
    );

    return { ok: true, checkoutId: checkoutRef.id };
}

export async function updateCityCampaignDelivery(input: { cityId: string; status: "active" | "paused" }) {
    const cityId = input.cityId.trim();
    if (!cityId) throw new ResponseError("city_required", "Indica la ciudad.");

    const cityRef = adminDb.collection("cities").doc(cityId);
    const citySnap = await cityRef.get();
    if (!citySnap.exists) throw new ResponseError("city_not_found", "La ciudad no existe.", 404);

    const city = citySnap.data() || {};
    if (city.status !== "occupied" && !city.activeSubscriptionId) {
        throw new ResponseError("city_not_occupied", "Solo puedes pausar o reanudar una ciudad ocupada.", 409);
    }

    const campaignId = String(city.activeCampaignId || city.campaignId || city.baseCampaignId || "");
    if (!campaignId) {
        throw new ResponseError("campaign_required", "La ciudad no tiene campana Meta configurada.", 409);
    }

    const adsetIds = Array.isArray(city.adsetIds) ? city.adsetIds.map((id) => String(id)).filter(Boolean) : [];
    const result =
        input.status === "paused"
            ? await pauseCityCampaign({ campaignId, adsetIds })
            : await resumeCityCampaign({ campaignId, adsetIds });

    await cityRef.set(
        {
            campaignDeliveryStatus: input.status,
            campaignDeliveryUpdatedAt: nowMs(),
            activeCampaignId: result.campaignId,
            adsetIds: result.adsetIds,
            updatedAt: nowMs(),
        },
        { merge: true },
    );

    return { ok: true, cityId, campaignId: result.campaignId, status: input.status };
}

export async function updateSubscriptionParticipantDelivery(input: {
    subscriptionId: string;
    status: "active" | "paused";
}) {
    const subscriptionId = input.subscriptionId.trim();
    if (!subscriptionId) throw new ResponseError("subscription_required", "Indica la suscripcion.");

    const subscriptionRef = adminDb.collection("subscriptions").doc(subscriptionId);
    const subscriptionSnap = await subscriptionRef.get();
    if (!subscriptionSnap.exists) throw new ResponseError("subscription_not_found", "La suscripcion no existe.", 404);

    const subscription = subscriptionSnap.data() || {};
    const currentStatus = String(subscription.status || "");
    const cityId = String(subscription.cityId || "");
    if (!cityId) throw new ResponseError("city_required", "La suscripcion no tiene ciudad asociada.", 409);
    if (!["active", "paused"].includes(currentStatus)) {
        throw new ResponseError("subscription_not_toggleable", "Solo puedes pausar o reanudar suscripciones activas o pausadas.", 409);
    }

    if (currentStatus === input.status) {
        return { ok: true, idempotent: true, subscriptionId, cityId, status: input.status };
    }

    await subscriptionRef.set(
        input.status === "paused"
            ? {
                status: "paused",
                pausedAt: nowMs(),
                pausedReason: "admin_participant_pause",
                updatedAt: nowMs(),
            }
            : {
                status: "active",
                resumedAt: nowMs(),
                pausedReason: FieldValue.delete(),
                updatedAt: nowMs(),
            },
        { merge: true },
    );

    const campaign = await syncSharedCityCampaignBudget(cityId);
    return {
        ok: true,
        subscriptionId,
        cityId,
        status: input.status,
        campaignId: campaign?.campaignId || null,
        sharedPoolDailyBudget: campaign?.dailyBudget ?? 0,
        activeParticipantsCount: campaign?.participantCount ?? 0,
    };
}

export async function releaseSubscriptionCity(cityId: string) {
    if (!cityId.trim()) {
        throw new ResponseError("city_required", "Indica la ciudad a liberar.");
    }

    const cityRef = adminDb.collection("cities").doc(cityId.trim());
    const citySnap = await cityRef.get();
    if (!citySnap.exists) throw new ResponseError("city_not_found", "La ciudad no existe.", 404);

    const city = citySnap.data() || {};
    const activeSubscriptionId = String(city.activeSubscriptionId || "");
    const reservedCheckoutId = String(city.reservedByCheckoutId || "");
    const campaignId = String(city.activeCampaignId || city.campaignId || city.baseCampaignId || "");
    const adsetIds = Array.isArray(city.adsetIds) ? city.adsetIds.map((id) => String(id)).filter(Boolean) : [];

    if (campaignId && (city.status === "occupied" || activeSubscriptionId)) {
        await pauseCityCampaign({ campaignId, adsetIds });
    }

    await adminDb.runTransaction(async (tx) => {
        const freshCitySnap = await tx.get(cityRef);
        if (!freshCitySnap.exists) return;
        const freshCity = freshCitySnap.data() || {};
        const activeSubscriptionIds = Array.isArray(freshCity.activeSubscriptionIds)
            ? freshCity.activeSubscriptionIds.map((id) => String(id)).filter(Boolean)
            : [];
        const freshSubscriptionId = String(freshCity.activeSubscriptionId || activeSubscriptionId || "");
        const subscriptionIdsToRelease = Array.from(new Set([...activeSubscriptionIds, freshSubscriptionId].filter(Boolean)));
        const freshReservedCheckoutId = String(freshCity.reservedByCheckoutId || reservedCheckoutId || "");

        // Reads must all happen before any writes in a Firestore transaction.
        const subscriptionRefs = subscriptionIdsToRelease.map((id) =>
            adminDb.collection("subscriptions").doc(id),
        );
        const subscriptionSnaps = await Promise.all(subscriptionRefs.map((ref) => tx.get(ref)));

        for (let i = 0; i < subscriptionIdsToRelease.length; i++) {
            const subscriptionRef = subscriptionRefs[i];
            const checkoutId = String(subscriptionSnaps[i].data()?.checkoutId || "");
            tx.set(
                subscriptionRef,
                {
                    status: "released",
                    releasedAt: nowMs(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            );

            if (checkoutId) {
                tx.set(
                    adminDb.collection("subscriptionCheckouts").doc(checkoutId),
                    {
                        activationStatus: "city_released",
                        releasedAt: nowMs(),
                        updatedAt: nowMs(),
                    },
                    { merge: true },
                );
            }
        }

        if (freshReservedCheckoutId) {
            tx.set(
                adminDb.collection("subscriptionCheckouts").doc(freshReservedCheckoutId),
                {
                    status: "expired",
                    activationStatus: "city_released",
                    releasedAt: nowMs(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            );
        }

        tx.set(
            cityRef,
            {
                status: "available",
                ownerUserId: null,
                ownerUserIds: [],
                activeSubscriptionId: FieldValue.delete(),
                activeSubscriptionIds: [],
                activeParticipantsCount: 0,
                activeCampaignId: FieldValue.delete(),
                campaignDeliveryStatus: FieldValue.delete(),
                campaignDeliveryUpdatedAt: FieldValue.delete(),
                adsetIds: FieldValue.delete(),
                adIds: FieldValue.delete(),
                sharedPoolDailyBudget: FieldValue.delete(),
                sharedPoolTargetSpend: FieldValue.delete(),
                reservedByCheckoutId: FieldValue.delete(),
                reservationExpiresAt: FieldValue.delete(),
                updatedAt: nowMs(),
            },
            { merge: true },
        );
    });

    return {
        ok: true,
        cityId: cityId.trim(),
    };
}

export async function expireDueSubscriptions(limit = 20) {
    const nowMillis = nowMs();
    // Stuck "expiring" docs older than 10 min are considered safe to resume.
    const stuckThresholdMs = nowMillis - 10 * 60 * 1000;

    const results: Array<{
        subscriptionId: string;
        cityId: string;
        status: "expired" | "failed" | "skipped";
        message?: string;
    }> = [];

    // ── 1. Active subscriptions past endDate (primary path) ──────────────────
    const activeSnap = await adminDb
        .collection("subscriptions")
        .where("status", "==", "active")
        .limit(Math.max(limit, 50))
        .get();

    // ── 2. Stuck "expiring" (process crashed between lock and completion) ─────
    // No composite index needed: filter expiringAt in memory (few docs expected).
    const stuckRaw = await adminDb
        .collection("subscriptions")
        .where("status", "==", "expiring")
        .limit(20)
        .get();
    const stuckDocs = stuckRaw.docs.filter(
        (d) => Number(d.data().expiringAt || 0) <= stuckThresholdMs,
    );
    const activeIds = new Set(activeSnap.docs.map((d) => d.id));

    // ── 3. Provisioning / meta_failed past endDate (no campaign to pause) ─────
    // These keep the city occupied even though no ads are running.
    const noCampaignRaw = await adminDb
        .collection("subscriptions")
        .where("status", "in", ["provisioning", "payment_approved_meta_failed"])
        .limit(20)
        .get();
    const expiredNoCampaign = noCampaignRaw.docs.filter((d) => {
        const endDate = timestampToMs(d.data().endDate);
        return endDate !== null && endDate <= nowMillis;
    });

    // ── Process active ────────────────────────────────────────────────────────
    for (const doc of activeSnap.docs) {
        if (results.filter((item) => item.status !== "skipped").length >= limit) break;
        const subscriptionId = doc.id;
        const subscription = doc.data();
        const cityId = String(subscription.cityId || "");
        const campaignId = String(subscription.campaignId || "");
        const adsetIds = Array.isArray(subscription.adsetIds)
            ? subscription.adsetIds.map((id) => String(id)).filter(Boolean)
            : [];

        if (!cityId) {
            await doc.ref.set(
                { status: "expiration_failed", expirationFailureReason: "missing_city", updatedAt: nowMs() },
                { merge: true },
            );
            results.push({ subscriptionId, cityId, status: "failed", message: "missing_city" });
            continue;
        }

        const endDateMs = timestampToMs(subscription.endDate);
        let expirationReason: "target_spend_reached" | "safety_deadline" | null =
            endDateMs !== null && endDateMs <= nowMillis ? "safety_deadline" : null;
        let spendSnapshot: Awaited<ReturnType<typeof getMetaCampaignCycleSpend>> | null = null;

        if (!expirationReason && campaignId) {
            const spendPauseThreshold = Number(subscription.spendPauseThreshold || subscription.targetSpend || subscription.adsBudget || 0);
            if (Number.isFinite(spendPauseThreshold) && spendPauseThreshold > 0) {
                try {
                    spendSnapshot = await getMetaCampaignCycleSpend({
                        campaignId,
                        spendBaseline: Number(subscription.spendBaseline || 0),
                    });
                    await doc.ref.set(
                        {
                            cycleSpend: spendSnapshot.cycleSpend,
                            metaTotalSpend: spendSnapshot.totalSpend,
                            spendBaseline: spendSnapshot.spendBaseline,
                            lastSpendCheckedAt: nowMs(),
                            lastSpendCheckFailure: FieldValue.delete(),
                            updatedAt: nowMs(),
                        },
                        { merge: true },
                    );
                    const citySnap = await adminDb.collection("cities").doc(cityId).get();
                    const city = citySnap.data() || {};
                    const isSharedPool = Number(city.activeParticipantsCount || 0) > 1;
                    const poolBaseline = Number(city.sharedPoolSpendBaseline || spendSnapshot.spendBaseline || 0);
                    const poolTarget = Number(city.sharedPoolTargetSpend || 0);
                    const poolCycleSpend = Math.max(0, Math.round((spendSnapshot.totalSpend - poolBaseline) * 100) / 100);
                    if (isSharedPool && poolTarget > 0) {
                        if (poolCycleSpend >= Math.round(poolTarget * 0.98 * 100) / 100) {
                            expirationReason = "target_spend_reached";
                        }
                    } else if (spendSnapshot.cycleSpend >= spendPauseThreshold) {
                        expirationReason = "target_spend_reached";
                    }
                } catch (error) {
                    await doc.ref.set(
                        {
                            lastSpendCheckedAt: nowMs(),
                            lastSpendCheckFailure: error instanceof Error ? error.message : "meta_spend_check_failed",
                            updatedAt: nowMs(),
                        },
                        { merge: true },
                    );
                }
            }
        }

        if (!expirationReason) continue;

        const locked = await adminDb.runTransaction(async (tx) => {
            const fresh = await tx.get(doc.ref);
            const data = fresh.data() || {};
            if (data.status !== "active") return false;
            tx.set(doc.ref, { status: "expiring", expiringAt: nowMs(), updatedAt: nowMs() }, { merge: true });
            return true;
        });

        if (!locked) {
            results.push({ subscriptionId, cityId, status: "skipped", message: "already_processing" });
            continue;
        }

        results.push(await expireWithCampaign(doc.ref, subscriptionId, subscription, cityId, campaignId, adsetIds, {
            reason: expirationReason,
            spendSnapshot,
        }));
    }

    // ── Process stuck expiring ────────────────────────────────────────────────
    for (const doc of stuckDocs) {
        if (activeIds.has(doc.id)) continue; // already handled above
        const subscriptionId = doc.id;
        const subscription = doc.data();
        const cityId = String(subscription.cityId || "");
        const campaignId = String(subscription.campaignId || "");
        const adsetIds = Array.isArray(subscription.adsetIds)
            ? subscription.adsetIds.map((id) => String(id)).filter(Boolean)
            : [];

        if (!cityId) {
            await doc.ref.set(
                { status: "expiration_failed", expirationFailureReason: "missing_city", updatedAt: nowMs() },
                { merge: true },
            );
            results.push({ subscriptionId, cityId, status: "failed", message: "missing_city_stuck" });
            continue;
        }

        // Verify it's still stuck (idempotency guard)
        const stillStuck = await adminDb.runTransaction(async (tx) => {
            return (await tx.get(doc.ref)).data()?.status === "expiring";
        });
        if (!stillStuck) {
            results.push({ subscriptionId, cityId, status: "skipped", message: "no_longer_stuck" });
            continue;
        }

        results.push(await expireWithCampaign(doc.ref, subscriptionId, subscription, cityId, campaignId, adsetIds, {
            reason: "safety_deadline",
            spendSnapshot: null,
        }));
    }

    // ── Process provisioning / meta_failed past endDate ───────────────────────
    for (const doc of expiredNoCampaign) {
        const subscriptionId = doc.id;
        const subscription = doc.data();
        const cityId = String(subscription.cityId || "");

        if (!cityId) {
            await doc.ref.set(
                { status: "expiration_failed", expirationFailureReason: "missing_city", updatedAt: nowMs() },
                { merge: true },
            );
            results.push({ subscriptionId, cityId, status: "failed", message: "missing_city_no_campaign" });
            continue;
        }

        try {
            const cityRef = adminDb.collection("cities").doc(cityId);
            await adminDb.runTransaction(async (tx) => {
                const fresh = await tx.get(doc.ref);
                const currentStatus = fresh.data()?.status;
                if (!["provisioning", "payment_approved_meta_failed"].includes(String(currentStatus))) return;

                const citySnap = await tx.get(cityRef);
                const city = citySnap.data() || {};
                const belongsToSubscription =
                    city.activeSubscriptionId === subscriptionId ||
                    (!city.activeSubscriptionId && city.ownerUserId === subscription.userId);

                tx.set(doc.ref, { status: "expired", endedAt: nowMs(), updatedAt: nowMs() }, { merge: true });

                if (citySnap.exists && belongsToSubscription) {
                    tx.set(cityRef, {
                        status: "available",
                        ownerUserId: null,
                        activeSubscriptionId: FieldValue.delete(),
                        activeCampaignId: FieldValue.delete(),
                        adsetIds: FieldValue.delete(),
                        adIds: FieldValue.delete(),
                        reservedByCheckoutId: FieldValue.delete(),
                        reservationExpiresAt: FieldValue.delete(),
                        updatedAt: nowMs(),
                    }, { merge: true });
                }
            });

            results.push({ subscriptionId, cityId, status: "expired" });
        } catch (error) {
            const message = error instanceof Error ? error.message : "expiration_failed";
            await doc.ref.set(
                { status: "expiration_failed", expirationFailureReason: message, updatedAt: nowMs() },
                { merge: true },
            );
            results.push({ subscriptionId, cityId, status: "failed", message });
        }
    }

    return { processed: results.length, results };
}

async function expireWithCampaign(
    docRef: ReturnType<typeof adminDb.collection>["doc"] extends (id: string) => infer R ? R : never,
    subscriptionId: string,
    subscription: FirebaseFirestore.DocumentData,
    cityId: string,
    campaignId: string,
    adsetIds: string[],
    meta?: {
        reason?: "target_spend_reached" | "safety_deadline";
        spendSnapshot?: Awaited<ReturnType<typeof getMetaCampaignCycleSpend>> | null;
    },
): Promise<{ subscriptionId: string; cityId: string; status: "expired" | "failed"; message?: string }> {
    try {
        const cityRef = adminDb.collection("cities").doc(cityId);
        const citySnap = await cityRef.get();
        const city = citySnap.data() || {};
        const activeSubscriptionIds = Array.isArray(city.activeSubscriptionIds)
            ? city.activeSubscriptionIds.map((id) => String(id)).filter(Boolean)
            : [];

        if (activeSubscriptionIds.length > 1) {
            if (meta?.reason === "target_spend_reached") {
                if (campaignId) {
                    await pauseCityCampaign({ campaignId, adsetIds });
                }

                await adminDb.runTransaction(async (tx) => {
                    for (const activeId of activeSubscriptionIds) {
                        tx.set(adminDb.collection("subscriptions").doc(activeId), {
                            status: "expired",
                            endedAt: nowMs(),
                            expirationReason: "target_spend_reached",
                            updatedAt: nowMs(),
                        }, { merge: true });
                    }
                    tx.set(cityRef, {
                        status: "available",
                        ownerUserId: null,
                        ownerUserIds: [],
                        activeSubscriptionId: FieldValue.delete(),
                        activeSubscriptionIds: [],
                        activeParticipantsCount: 0,
                        activeCampaignId: FieldValue.delete(),
                        campaignDeliveryStatus: FieldValue.delete(),
                        campaignDeliveryUpdatedAt: FieldValue.delete(),
                        adsetIds: FieldValue.delete(),
                        adIds: FieldValue.delete(),
                        reservedByCheckoutId: FieldValue.delete(),
                        reservationExpiresAt: FieldValue.delete(),
                        sharedPoolDailyBudget: FieldValue.delete(),
                        sharedPoolTargetSpend: FieldValue.delete(),
                        updatedAt: nowMs(),
                    }, { merge: true });
                });

                return { subscriptionId, cityId, status: "expired" };
            }

            await docRef.set(
                {
                    status: "expired",
                    endedAt: nowMs(),
                    expirationReason: meta?.reason || "safety_deadline",
                    updatedAt: nowMs(),
                },
                { merge: true },
            );
            await syncSharedCityCampaignBudget(cityId);
            return { subscriptionId, cityId, status: "expired" };
        }

        if (campaignId) {
            await pauseCityCampaign({ campaignId, adsetIds });
        }

        await adminDb.runTransaction(async (tx) => {
            const citySnap = await tx.get(cityRef);
            const city = citySnap.data() || {};
            const belongsToSubscription =
                city.activeSubscriptionId === subscriptionId ||
                (!city.activeSubscriptionId &&
                    city.ownerUserId === subscription.userId &&
                    (city.activeCampaignId === campaignId || city.campaignId === campaignId));

            tx.set(docRef, {
                status: "expired",
                endedAt: nowMs(),
                expirationReason: meta?.reason || "safety_deadline",
                ...(meta?.spendSnapshot
                    ? {
                        cycleSpend: meta.spendSnapshot.cycleSpend,
                        metaTotalSpend: meta.spendSnapshot.totalSpend,
                        spendBaseline: meta.spendSnapshot.spendBaseline,
                        lastSpendCheckedAt: nowMs(),
                    }
                    : {}),
                updatedAt: nowMs(),
            }, { merge: true });

            if (citySnap.exists && belongsToSubscription) {
                tx.set(cityRef, {
                    status: "available",
                    ownerUserId: null,
                    activeSubscriptionId: FieldValue.delete(),
                    activeCampaignId: FieldValue.delete(),
                    campaignDeliveryStatus: FieldValue.delete(),
                    campaignDeliveryUpdatedAt: FieldValue.delete(),
                    adsetIds: FieldValue.delete(),
                    adIds: FieldValue.delete(),
                    reservedByCheckoutId: FieldValue.delete(),
                    reservationExpiresAt: FieldValue.delete(),
                    updatedAt: nowMs(),
                }, { merge: true });
            }
        });

        return { subscriptionId, cityId, status: "expired" };
    } catch (error) {
        const message = error instanceof Error ? error.message : "expiration_failed";
        await docRef.set(
            { status: "expiration_failed", expirationFailureReason: message, updatedAt: nowMs() },
            { merge: true },
        );
        return { subscriptionId, cityId, status: "failed", message };
    }
}
