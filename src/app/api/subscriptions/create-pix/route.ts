import { canManageSubscriptionCheckout, errorResponse, requireServerUser, ResponseError } from "@/server/auth";
import { createPixSubscriptionCheckout } from "@/server/subscriptions/subscriptionService";
import type { SubscriptionPlanId } from "@/types/subscriptions";

const validPlans = new Set<SubscriptionPlanId>(["base", "crecimiento", "dominio", "custom"]);

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        const body = await request.json();

        const userId = String(body.userId || user.uid);
        const cityId = String(body.cityId || "");
        const plan = String(body.plan || "") as SubscriptionPlanId;
        const email = String(body.email || user.token.email || "");
        const customAmount = body.amount === undefined ? undefined : Number(body.amount);

        if (!canManageSubscriptionCheckout(user, userId)) {
            throw new ResponseError("forbidden_user", "No puedes crear pagos para este usuario.", 403);
        }

        if (!cityId) throw new ResponseError("city_required", "Selecciona una ciudad.");
        if (!validPlans.has(plan)) throw new ResponseError("invalid_plan", "Selecciona un plan valido.");
        if (!email || !email.includes("@")) {
            throw new ResponseError("email_required", "Mercado Pago necesita un correo valido para el Pix.");
        }

        const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
        const notificationUrl =
            process.env.MERCADOPAGO_WEBHOOK_URL ||
            (origin ? `${origin}/api/webhook/mercadopago` : "");

        if (!notificationUrl) {
            throw new ResponseError(
                "webhook_url_missing",
                "Configura MERCADOPAGO_WEBHOOK_URL o NEXT_PUBLIC_APP_URL.",
                500,
            );
        }

        const pix = await createPixSubscriptionCheckout({
            userId,
            cityId,
            plan,
            customAmount,
            email,
            notificationUrl,
        });

        return Response.json({ ok: true, pix });
    } catch (error) {
        return errorResponse(error);
    }
}
