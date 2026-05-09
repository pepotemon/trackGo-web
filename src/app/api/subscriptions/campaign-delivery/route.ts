import { errorResponse, requireServerUser, requireSubscriptionsEdit, ResponseError } from "@/server/auth";
import { updateCityCampaignDelivery } from "@/server/subscriptions/subscriptionService";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const cityId = String(body.cityId || "");
        const status = String(body.status || "");

        if (!cityId) throw new ResponseError("city_required", "Indica la ciudad.");
        if (status !== "active" && status !== "paused") {
            throw new ResponseError("invalid_status", "Indica si quieres pausar o reanudar la campana.");
        }

        const result = await updateCityCampaignDelivery({ cityId, status });
        return Response.json(result);
    } catch (error) {
        return errorResponse(error);
    }
}
