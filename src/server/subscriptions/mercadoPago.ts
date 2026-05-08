import { ResponseError } from "@/server/auth";

type CreatePixPaymentInput = {
    checkoutId: string;
    userId: string;
    cityId: string;
    cityName: string;
    plan: string;
    amount: number;
    email: string;
    notificationUrl: string;
};

export type MercadoPagoPayment = {
    id: number | string;
    status: string;
    transaction_amount: number;
    external_reference?: string;
    metadata?: Record<string, unknown>;
    point_of_interaction?: {
        transaction_data?: {
            qr_code?: string;
            qr_code_base64?: string;
            ticket_url?: string;
        };
    };
    date_of_expiration?: string;
};

type MercadoPagoErrorBody = {
    message?: string;
    error?: string;
    status?: number;
    cause?: Array<{
        code?: string | number;
        description?: string;
        data?: string;
    }>;
};

function mercadoPagoToken() {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
    if (!token) {
        throw new ResponseError(
            "mercadopago_missing_token",
            "Falta MERCADOPAGO_ACCESS_TOKEN en variables de entorno.",
            500,
        );
    }
    return token;
}

export async function createPixPayment(input: CreatePixPaymentInput) {
    const response = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${mercadoPagoToken()}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": input.checkoutId,
        },
        body: JSON.stringify({
            transaction_amount: input.amount,
            description: `TrackGo ${input.cityName} - ${input.plan}`,
            payment_method_id: "pix",
            payer: {
                email: input.email,
            },
            external_reference: input.checkoutId,
            notification_url: input.notificationUrl,
            metadata: {
                checkoutId: input.checkoutId,
                userId: input.userId,
                cityId: input.cityId,
                city: input.cityName,
                plan: input.plan,
            },
        }),
    });

    const data = (await response.json()) as MercadoPagoPayment & MercadoPagoErrorBody;

    if (!response.ok) {
        console.error("[mercadopago:createPixPayment]", data);
        throw new ResponseError(
            "mercadopago_payment_error",
            formatMercadoPagoError(data) || "Mercado Pago no pudo crear el Pix.",
            502,
        );
    }

    const transactionData = data.point_of_interaction?.transaction_data;
    if (!transactionData?.qr_code || !transactionData.qr_code_base64) {
        throw new ResponseError("pix_qr_missing", "Mercado Pago no devolvio QR Pix.", 502);
    }

    return data;
}

export async function getMercadoPagoPayment(paymentId: string) {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
            Authorization: `Bearer ${mercadoPagoToken()}`,
        },
    });

    const data = (await response.json()) as MercadoPagoPayment & MercadoPagoErrorBody;
    if (!response.ok) {
        console.error("[mercadopago:getPayment]", data);
        throw new ResponseError("mercadopago_lookup_error", formatMercadoPagoError(data) || "No se pudo consultar el pago.", 502);
    }

    return data;
}

function formatMercadoPagoError(data: MercadoPagoErrorBody) {
    const cause = data.cause
        ?.map((item) => [item.code ? `code=${item.code}` : "", item.description, item.data].filter(Boolean).join(" · "))
        .filter(Boolean)
        .join(" | ");

    return [data.message, data.error, cause, data.status ? `status=${data.status}` : ""]
        .filter(Boolean)
        .join(" | ");
}
