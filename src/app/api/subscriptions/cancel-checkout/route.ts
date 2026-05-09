import { errorResponse, requireServerUser, ResponseError } from "@/server/auth";
import { cancelPendingSubscriptionCheckout } from "@/server/subscriptions/subscriptionService";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        const body = await request.json();
        const checkoutId = String(body.checkoutId || "");
        if (!checkoutId) throw new ResponseError("checkout_required", "Indica el Pix pendiente a cancelar.");

        const result = await cancelPendingSubscriptionCheckout({
            checkoutId,
            userId: user.uid,
        });

        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}
