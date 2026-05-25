import { errorResponse, requireServerUser, requireSubscriptionsEdit, ResponseError } from "@/server/auth";
import { updateSubscriptionParticipantDelivery } from "@/server/subscriptions/subscriptionService";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const subscriptionId = String(body.subscriptionId || "");
        const status = String(body.status || "");

        if (!subscriptionId) throw new ResponseError("subscription_required", "Indica la suscripcion.");
        if (status !== "active" && status !== "paused") {
            throw new ResponseError("invalid_status", "Estado invalido.");
        }

        const result = await updateSubscriptionParticipantDelivery({ subscriptionId, status });
        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}
