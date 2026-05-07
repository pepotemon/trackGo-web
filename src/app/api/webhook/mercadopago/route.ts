import { errorResponse, ResponseError } from "@/server/auth";
import { processMercadoPagoPayment } from "@/server/subscriptions/subscriptionService";
import { createHmac, timingSafeEqual } from "crypto";

function paymentIdFromPayload(body: Record<string, unknown>) {
    const data = body.data;
    if (data && typeof data === "object" && "id" in data) {
        return String((data as { id: unknown }).id || "");
    }

    if (typeof body.resource === "string") {
        const parts = body.resource.split("/");
        return parts[parts.length - 1] || "";
    }

    return "";
}

export async function POST(request: Request) {
    try {
        const rawUrl = new URL(request.url);
        const body = (await request.json()) as Record<string, unknown>;
        verifyMercadoPagoSignature(request, rawUrl, body);

        const type = String(body.type || body.action || "");

        if (type && !type.includes("payment")) {
            return Response.json({ ok: true, ignored: true, type });
        }

        const paymentId = paymentIdFromPayload(body);
        if (!paymentId) throw new ResponseError("payment_id_missing", "Webhook sin payment id.", 400);

        const result = await processMercadoPagoPayment(paymentId);
        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}

function verifyMercadoPagoSignature(request: Request, url: URL, body: Record<string, unknown>) {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) return;

    const signature = request.headers.get("x-signature") || "";
    const requestId = request.headers.get("x-request-id") || "";
    const parts = new Map(
        signature
            .split(",")
            .map((part) => part.split("=").map((value) => value.trim()))
            .filter((part): part is [string, string] => part.length === 2),
    );

    const ts = parts.get("ts");
    const hash = parts.get("v1");
    const urlDataId = url.searchParams.get("data.id") || url.searchParams.get("id");
    const bodyData = body.data;
    const bodyDataId =
        bodyData && typeof bodyData === "object" && "id" in bodyData
            ? String((bodyData as { id: unknown }).id || "")
            : "";
    const dataId = urlDataId || bodyDataId;

    if (!ts || !hash || !requestId || !dataId) {
        throw new ResponseError("invalid_webhook_signature", "Webhook Mercado Pago sin firma valida.", 401);
    }

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac("sha256", secret).update(manifest).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(hash, "hex");

    if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
        throw new ResponseError("invalid_webhook_signature", "Firma Mercado Pago invalida.", 401);
    }
}
