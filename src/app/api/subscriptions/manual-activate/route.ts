import { errorResponse, requireServerUser, requireSubscriptionsEdit, ResponseError } from "@/server/auth";
import { activateManualSubscription } from "@/server/subscriptions/subscriptionService";
import type { SubscriptionPlanId } from "@/types/subscriptions";

const validPlans = new Set<SubscriptionPlanId>(["crecimiento", "dominio", "custom"]);

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const userId = String(body.userId || "");
        const cityId = String(body.cityId || "");
        const plan = String(body.plan || "") as SubscriptionPlanId;
        const customAmount = body.amount === undefined ? undefined : Number(body.amount);
        const cycleDays = body.cycleDays === undefined ? undefined : Number(body.cycleDays);
        const syncMeta = body.syncMeta !== false;

        if (!userId) throw new ResponseError("user_required", "Selecciona un vendedor.");
        if (!cityId) throw new ResponseError("city_required", "Selecciona una ciudad.");
        if (!validPlans.has(plan)) throw new ResponseError("invalid_plan", "Selecciona un plan valido.");

        const result = await activateManualSubscription({
            userId,
            cityId,
            plan,
            customAmount,
            cycleDays,
            syncMeta,
            createdBy: user.uid,
            createdByName: String(user.token.email || user.uid),
        });

        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}
