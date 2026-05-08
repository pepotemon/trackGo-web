import { canManageSubscriptionCheckout, errorResponse, requireServerUser, ResponseError } from "@/server/auth";
import { getUserSubscriptionPortal } from "@/server/subscriptions/subscriptionService";

export async function GET(request: Request) {
    try {
        const user = await requireServerUser(request);
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId") || user.uid;

        if (!canManageSubscriptionCheckout(user, userId)) {
            throw new ResponseError("forbidden_user", "No puedes consultar suscripciones de este usuario.", 403);
        }

        const portal = await getUserSubscriptionPortal(userId);
        return Response.json({ ok: true, ...portal });
    } catch (error) {
        return errorResponse(error);
    }
}
