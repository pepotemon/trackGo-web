import { errorResponse, requireServerUser, requireSubscriptionsEdit, ResponseError } from "@/server/auth";
import { hideCheckoutFromUser } from "@/server/subscriptions/subscriptionService";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const checkoutId = String(body.checkoutId || "");
        if (!checkoutId) throw new ResponseError("checkout_required", "Indica el checkout.");

        const result = await hideCheckoutFromUser(checkoutId);
        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}
