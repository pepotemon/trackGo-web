import { errorResponse, requireServerUser, requireSuperAdmin, ResponseError } from "@/server/auth";
import { retryMetaActivation } from "@/server/subscriptions/subscriptionService";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSuperAdmin(user);
        const body = await request.json();
        const checkoutId = String(body.checkoutId || "");
        if (!checkoutId) throw new ResponseError("checkout_required", "Indica el checkout a reintentar.");
        const result = await retryMetaActivation(checkoutId);
        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}
