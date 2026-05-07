import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { ResponseError } from "@/server/auth";
import { adminDb } from "@/server/firebaseAdmin";
import { createPixPayment, getMercadoPagoPayment } from "@/server/subscriptions/mercadoPago";
import { calculateAdsBudget, calculateCycleEnd, getPlanAmount } from "@/server/subscriptions/plans";
import { duplicateAndActivateCampaign } from "@/server/subscriptions/metaAds";
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
            baseCampaignId: data.baseCampaignId || null,
            campaignId: data.campaignId || null,
            reservedByCheckoutId: isExpiredReservation ? null : data.reservedByCheckoutId || null,
            reservationExpiresAt: isExpiredReservation ? null : reservationExpiresAt,
            updatedAt: Number(data.updatedAt || 0) || null,
        };
    });
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

        const baseCampaignId = city.baseCampaignId;
        if (!baseCampaignId || typeof baseCampaignId !== "string") {
            throw new ResponseError(
                "city_missing_base_campaign",
                "Esta ciudad no tiene campana base configurada.",
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
            baseCampaignId,
        };
    });

    const payment = await createPixPayment({
        checkoutId,
        userId: input.userId,
        cityId: input.cityId,
        cityName: cityData.name,
        plan: input.plan,
        amount,
        email: input.email,
        notificationUrl: input.notificationUrl,
    });

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
        const campaign = await duplicateAndActivateCampaign({
            baseCampaignId: String(transactionResult.city.baseCampaignId),
            cityName: String(checkout.cityName),
            userId: String(checkout.userId),
            adsBudget: Number(checkout.adsBudget || 0),
        });

        await Promise.all([
            cityRef.set(
                {
                    campaignId: campaign.campaignId,
                    adsetIds: campaign.adsetIds,
                    updatedAt: nowMs(),
                },
                { merge: true },
            ),
            subscriptionRef.set(
                {
                    status: "active",
                    campaignId: campaign.campaignId,
                    adsetIds: campaign.adsetIds,
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
