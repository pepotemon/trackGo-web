import { errorResponse, requireServerUser, requireSubscriptionsEdit, ResponseError } from "@/server/auth";
import { releaseSubscriptionCity } from "@/server/subscriptions/subscriptionService";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const cityId = String(body.cityId || "");
        if (!cityId) throw new ResponseError("city_required", "Indica la ciudad a liberar.");
        const result = await releaseSubscriptionCity(cityId);
        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}
