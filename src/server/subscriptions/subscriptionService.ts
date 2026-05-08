import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { ResponseError } from "@/server/auth";
import { adminDb } from "@/server/firebaseAdmin";
import { createPixPayment, getMercadoPagoPayment } from "@/server/subscriptions/mercadoPago";
import { calculateAdsBudget, calculateCycleEnd, getPlanAmount } from "@/server/subscriptions/plans";
import { configureAndActivateCityCampaign } from "@/server/subscriptions/metaAds";
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
    const adsBudget = calculateAdsBudget(amount);
    const checkoutRef = adminDb.collection("subscriptionCheckouts").doc(checkoutId);
    const cityRef = adminDb.collection("cities").doc(input.cityId);
    const reservationExpiresAt = nowMs() + RESERVATION_TTL_MS;

    const cityData = await adminDb.runTransaction(async (tx) => {
        const citySnap = await tx.get(cityRef);
        if (!citySnap.exists) {
            throw new ResponseError("city_not_found", "La ciudad seleccionada no existe.", 404);
        }

        const city = citySnap.data() || {};
        const cityStatus = city.status || "available";
        const currentReservationExpiresAt = Number(city.reservationExpiresAt || 0);
        const reservedByThisCheckout = city.reservedByCheckoutId === checkoutId;
        const reservationExpired = cityStatus === "reserved" && currentReservationExpiresAt < nowMs();

        if (cityStatus === "occupied") {
            throw new ResponseError("city_occupied", "Esta ciudad ya esta ocupada por otro usuario.", 409);
        }

        if (cityStatus === "reserved" && !reservationExpired && !reservedByThisCheckout) {
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
            endDate: Timestamp.fromDate(calculateCycleEnd(startDate)),
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
        });

        await Promise.all([
            cityRef.set(
                {
                    activeCampaignId: campaign.campaignId,
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
                    lifetimeBudget: campaign.lifetimeBudget,
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
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
        ]);
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
        });

        await Promise.all([
            cityRef.set(
                {
                    status: "occupied",
                    ownerUserId: String(checkout.userId),
                    activeCampaignId: campaign.campaignId,
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
                    status: "active",
                    campaignId: campaign.campaignId,
                    adsetIds: campaign.adsetIds,
                    adIds: campaign.adIds,
                    lifetimeBudget: campaign.lifetimeBudget,
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
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
        ]);

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
