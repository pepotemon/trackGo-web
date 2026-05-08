import { errorResponse, requireServerUser, requireSubscriptionReadAccess, requireSubscriptionsEdit } from "@/server/auth";
import { listSubscriptionCities, saveSubscriptionCity } from "@/server/subscriptions/subscriptionService";

export async function GET(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionReadAccess(user);
        const cities = await listSubscriptionCities();
        return Response.json({ ok: true, cities });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const city = await saveSubscriptionCity({
            id: typeof body.id === "string" ? body.id : undefined,
            name: String(body.name || ""),
            state: typeof body.state === "string" ? body.state : undefined,
            country: typeof body.country === "string" ? body.country : undefined,
            status: typeof body.status === "string" ? body.status : undefined,
            campaignId: String(body.campaignId || body.baseCampaignId || ""),
        });
        return Response.json({ ok: true, city });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function PATCH(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const city = await saveSubscriptionCity({
            id: String(body.id || ""),
            name: String(body.name || ""),
            state: typeof body.state === "string" ? body.state : undefined,
            country: typeof body.country === "string" ? body.country : undefined,
            status: typeof body.status === "string" ? body.status : undefined,
            campaignId: String(body.campaignId || body.baseCampaignId || ""),
        });
        return Response.json({ ok: true, city });
    } catch (error) {
        return errorResponse(error);
    }
}
