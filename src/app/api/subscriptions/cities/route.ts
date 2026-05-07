import { errorResponse, requireServerUser } from "@/server/auth";
import { listSubscriptionCities } from "@/server/subscriptions/subscriptionService";

export async function GET(request: Request) {
    try {
        await requireServerUser(request);
        const cities = await listSubscriptionCities();
        return Response.json({ ok: true, cities });
    } catch (error) {
        return errorResponse(error);
    }
}
