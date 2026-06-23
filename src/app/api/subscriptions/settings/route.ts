import { errorResponse, requireServerUser, requireSubscriptionReadAccess, requireSubscriptionsEdit } from "@/server/auth";
import { getSubscriptionSettings, saveSubscriptionSettings } from "@/server/subscriptions/subscriptionService";

export async function GET(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionReadAccess(user);
        const settings = await getSubscriptionSettings();
        return Response.json({ ok: true, settings });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function PATCH(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSubscriptionsEdit(user);
        const body = await request.json();
        const settings = await saveSubscriptionSettings({
            adsShare: Number(body.adsShare),
            cycleDays: Number(body.cycleDays),
            taxRate: Number(body.taxRate ?? 0),
        });
        return Response.json({ ok: true, settings });
    } catch (error) {
        return errorResponse(error);
    }
}
