import { errorResponse, requireServerUser, requireSubscriptionsView } from "@/server/auth";
import { getSubscriptionsOverview } from "@/server/subscriptions/subscriptionService";

export async function GET(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsView(user);

        const overview = await getSubscriptionsOverview();
        return Response.json({ ok: true, ...overview });
    } catch (error) {
        return errorResponse(error);
    }
}
