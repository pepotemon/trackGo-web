import { errorResponse, requireServerUser, requireSuperAdmin, ResponseError } from "@/server/auth";
import { validateCityCampaign } from "@/server/subscriptions/metaAds";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSuperAdmin(user);
        const body = await request.json();
        const campaignId = String(body.campaignId || body.baseCampaignId || "");
        if (!campaignId) throw new ResponseError("campaign_required", "Pega el ID de campana Meta.");
        const campaign = await validateCityCampaign(campaignId);
        return Response.json({ ok: true, campaign });
    } catch (error) {
        return errorResponse(error);
    }
}
