import { errorResponse, requireServerUser, requireSuperAdmin, ResponseError } from "@/server/auth";
import { validateMetaCampaign } from "@/server/subscriptions/metaAds";

export async function POST(request: Request) {
    try {
        const user = await requireServerUser(request);
        requireSuperAdmin(user);
        const body = await request.json();
        const baseCampaignId = String(body.baseCampaignId || "");
        if (!baseCampaignId) throw new ResponseError("base_campaign_required", "Pega el ID de campana base.");
        const campaign = await validateMetaCampaign(baseCampaignId);
        return Response.json({ ok: true, campaign });
    } catch (error) {
        return errorResponse(error);
    }
}
