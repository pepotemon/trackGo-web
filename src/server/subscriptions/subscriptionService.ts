import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { ResponseError } from "@/server/auth";
import { adminDb } from "@/server/firebaseAdmin";
import { cancelMercadoPagoPayment, createPixPayment, getMercadoPagoPayment } from "@/server/subscriptions/mercadoPago";
import { calculateAdsBudget, calculateAdsBudgetAllocation, calculateCycleEnd, getPlanAmount } from "@/server/subscriptions/plans";
import { configureAndActivateCityCampaign, pauseCityCampaign } from "@/server/subscriptions/metaAds";
import { sendPushToUser } from "@/server/push";
import type { PixCheckoutResponse, SubscriptionPlanId } from "@/types/subscriptions";

const RESERVATION_TTL_MS = 30 * 60 * 1000;

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
            campaignId: data.campaignId || null,
            baseCampaignId: data.baseCampaignId || null,
            reservedByCheckoutId: isExpiredReservation ? null : data.reservedByCheckoutId || null,
            reservationExpiresAt: isExpiredReservation ? null : reservationExpiresAt,
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

export async function getSubscriptionsOverview() {
    const [cities, settings, subscriptionsSnap, checkoutsSnap, usersSnap] = await Promise.all([
        listSubscriptionCities(),
        getSubscriptionSettings(),
        adminDb.collection("subscriptions").orderBy("updatedAt", "desc").limit(30).get(),
        adminDb.collection("subscriptionCheckouts").orderBy("updatedAt", "desc").limit(40).get(),
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

    const subscriptions = subscriptionsSnap.docs.map((doc) => {
        const data = doc.data();
        const user = users.get(String(data.userId || ""));
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
            status: data.status || "unknown",
            campaignId: data.campaignId || null,
            startDate: timestampToMs(data.startDate),
            endDate: timestampToMs(data.endDate),
            createdAt: Number(data.createdAt || 0) || null,
            updatedAt: Number(data.updatedAt || 0) || null,
        };
    });

    const checkouts = checkoutsSnap.docs.map((doc) => {
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
            createdAt: Number(data.createdAt || 0) || null,
            updatedAt: Number(data.updatedAt || 0) || null,
            paymentApprovedAt: Number(data.paymentApprovedAt || 0) || null,
        };
    });

    return {
        settings,
        cities,
        subscriptions,
        checkouts,
    };
}

function timestampToMs(value: unknown) {
    if (!value) return null;
    if (typeof value === "number") return value;
    if (typeof value === "object" && value !== null && "toMillis" in value) {
        return (value as { toMillis: () => number }).toMillis();
    }
    return null;
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
            throw new ResponseError("city_occupied", "Esta ciudad ya esta ocupada por otro usuario.", 409);
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
            adsShare: settings.adsShare,
            cycleDays: settings.cycleDays,
            paymentId: "",
            status: "pending",
            activationStatus: "waiting_payment",
            createdAt: nowMs(),
            updatedAt: nowMs(),
        });

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

        if (city.status === "occupied" && city.ownerUserId !== freshCheckout.userId) {
            tx.set(
                checkoutRef,
                {
                    status: "approved",
                    activationStatus: "city_occupied",
                    updatedAt: nowMs(),
                },
                { merge: true },
            );
            throw new ResponseError("city_occupied_after_payment", "La ciudad ya fue tomada por otro usuario.", 409);
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
                ownerUserId: freshCheckout.userId,
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
        const campaign = await configureAndActivateCityCampaign({
            campaignId: String(transactionResult.city.campaignId || transactionResult.city.baseCampaignId),
            cityName: String(checkout.cityName),
            userId: String(checkout.userId),
            adsBudget: Number(checkout.adsBudget || 0),
            cycleDays: Number(checkout.cycleDays || 5) || 5,
        });

        await Promise.all([
            cityRef.set(
                {
                    activeCampaignId: campaign.campaignId,
                    activeSubscriptionId: checkoutId,
                    adsetIds: campaign.adsetIds,
                    adIds: campaign.adIds,
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            subscriptionRef.set(
                {
                    status: "active",
                    campaignId: campaign.campaignId,
                    adsetIds: campaign.adsetIds,
                    adIds: campaign.adIds,
                    dailyBudget: campaign.dailyBudget,
                    operatingBudget: campaign.operatingBudget,
                    reservedBudget: campaign.reservedBudget,
                    totalBudget: campaign.totalBudget,
                    reservePercent: campaign.reservePercent,
                    startDate: Timestamp.fromDate(campaign.startDate),
                    endDate: Timestamp.fromDate(campaign.endDate),
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            checkoutRef.set(
                {
                    activationStatus: "active",
                    campaignId: campaign.campaignId,
                    dailyBudget: campaign.dailyBudget,
                    operatingBudget: campaign.operatingBudget,
                    reservedBudget: campaign.reservedBudget,
                    totalBudget: campaign.totalBudget,
                    reservePercent: campaign.reservePercent,
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
    const campaignId = String(city.campaignId || city.baseCampaignId || "");
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
        const campaign = await configureAndActivateCityCampaign({
            campaignId,
            cityName: String(checkout.cityName || city.name || checkout.cityId),
            userId: String(checkout.userId),
            adsBudget: Number(checkout.adsBudget || 0),
            cycleDays: Number(checkout.cycleDays || 5) || 5,
        });

        await Promise.all([
            cityRef.set(
                {
                    status: "occupied",
                    ownerUserId: String(checkout.userId),
                    activeCampaignId: campaign.campaignId,
                    activeSubscriptionId: checkoutId,
                    adsetIds: campaign.adsetIds,
                    adIds: campaign.adIds,
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            subscriptionRef.set(
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
                    cycleDays: Number(checkout.cycleDays || 5) || 5,
                    status: "active",
                    campaignId: campaign.campaignId,
                    adsetIds: campaign.adsetIds,
                    adIds: campaign.adIds,
                    dailyBudget: campaign.dailyBudget,
                    operatingBudget: campaign.operatingBudget,
                    reservedBudget: campaign.reservedBudget,
                    totalBudget: campaign.totalBudget,
                    reservePercent: campaign.reservePercent,
                    startDate: Timestamp.fromDate(campaign.startDate),
                    endDate: Timestamp.fromDate(campaign.endDate),
                    updatedAt: nowMs(),
                    createdAt: checkout.paymentApprovedAt || checkout.createdAt || nowMs(),
                },
                { merge: true },
            ),
            checkoutRef.set(
                {
                    activationStatus: "active",
                    campaignId: campaign.campaignId,
                    dailyBudget: campaign.dailyBudget,
                    operatingBudget: campaign.operatingBudget,
                    reservedBudget: campaign.reservedBudget,
                    totalBudget: campaign.totalBudget,
                    reservePercent: campaign.reservePercent,
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
        const freshSubscriptionId = String(freshCity.activeSubscriptionId || activeSubscriptionId || "");
        const freshReservedCheckoutId = String(freshCity.reservedByCheckoutId || reservedCheckoutId || "");

        if (freshSubscriptionId) {
            tx.set(
                adminDb.collection("subscriptions").doc(freshSubscriptionId),
                {
                    status: "released",
                    releasedAt: nowMs(),
                    updatedAt: nowMs(),
                },
                { merge: true },
            );
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
                activeSubscriptionId: FieldValue.delete(),
                activeCampaignId: FieldValue.delete(),
                adsetIds: FieldValue.delete(),
                adIds: FieldValue.delete(),
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
    const now = Timestamp.now();
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
        .where("endDate", "<=", now)
        .limit(limit)
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
        const subscriptionId = doc.id;
        const subscription = doc.data();
        const cityId = String(subscription.cityId || "");
        const campaignId = String(subscription.campaignId || "");
        const adsetIds = Array.isArray(subscription.adsetIds)
            ? subscription.adsetIds.map((id) => String(id)).filter(Boolean)
            : [];

        if (!cityId || !campaignId) {
            await doc.ref.set(
                { status: "expiration_failed", expirationFailureReason: "missing_city_or_campaign", updatedAt: nowMs() },
                { merge: true },
            );
            results.push({ subscriptionId, cityId, status: "failed", message: "missing_city_or_campaign" });
            continue;
        }

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

        results.push(await expireWithCampaign(doc.ref, subscriptionId, subscription, cityId, campaignId, adsetIds));
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

        results.push(await expireWithCampaign(doc.ref, subscriptionId, subscription, cityId, campaignId, adsetIds));
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
): Promise<{ subscriptionId: string; cityId: string; status: "expired" | "failed"; message?: string }> {
    try {
        if (campaignId) {
            await pauseCityCampaign({ campaignId, adsetIds });
        }

        const cityRef = adminDb.collection("cities").doc(cityId);
        await adminDb.runTransaction(async (tx) => {
            const citySnap = await tx.get(cityRef);
            const city = citySnap.data() || {};
            const belongsToSubscription =
                city.activeSubscriptionId === subscriptionId ||
                (!city.activeSubscriptionId &&
                    city.ownerUserId === subscription.userId &&
                    (city.activeCampaignId === campaignId || city.campaignId === campaignId));

            tx.set(docRef, { status: "expired", endedAt: nowMs(), updatedAt: nowMs() }, { merge: true });

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
