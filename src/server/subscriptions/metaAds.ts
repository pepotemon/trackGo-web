import { ResponseError } from "@/server/auth";
import { calculateCycleEnd } from "@/server/subscriptions/plans";

const GRAPH_VERSION = "v19.0";

function metaConfig() {
    const token = process.env.META_ACCESS_TOKEN?.trim();
    const adAccountId = process.env.META_AD_ACCOUNT_ID?.trim();

    if (!token || !adAccountId) {
        throw new ResponseError(
            "meta_missing_config",
            "Faltan META_ACCESS_TOKEN o META_AD_ACCOUNT_ID en variables de entorno.",
            500,
        );
    }

    return { token, adAccountId };
}

async function graphPost<T>(path: string, body: Record<string, string | number | boolean>) {
    const { token } = metaConfig();
    const params = new URLSearchParams();
    Object.entries(body).forEach(([key, value]) => params.set(key, String(value)));
    params.set("access_token", token);

    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
    });

    const data = (await response.json()) as T & { error?: { message?: string; code?: number } };
    if (!response.ok || data.error) {
        console.error("[meta:post]", path, data);
        throw new ResponseError("meta_api_error", formatMetaError(data.error) || "Meta no pudo completar la operacion.", 502);
    }

    return data;
}

async function graphGet<T>(path: string, query?: Record<string, string>) {
    const { token } = metaConfig();
    const params = new URLSearchParams(query);
    params.set("access_token", token);

    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}?${params.toString()}`);
    const data = (await response.json()) as T & { error?: { message?: string; code?: number } };
    if (!response.ok || data.error) {
        console.error("[meta:get]", path, data);
        throw new ResponseError("meta_api_error", formatMetaError(data.error) || "Meta no pudo consultar datos.", 502);
    }

    return data;
}

function formatMetaError(error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
}) {
    if (!error) return "";
    return [
        error.message,
        error.error_user_title,
        error.error_user_msg,
        error.code ? `code=${error.code}` : "",
        error.error_subcode ? `subcode=${error.error_subcode}` : "",
        error.fbtrace_id ? `trace=${error.fbtrace_id}` : "",
    ]
        .filter(Boolean)
        .join(" | ");
}

export async function configureAndActivateCityCampaign({
    campaignId,
    cityName,
    userId,
    adsBudget,
}: {
    campaignId: string;
    cityName: string;
    userId: string;
    adsBudget: number;
}) {
    const campaign = await validateMetaCampaign(campaignId);
    const adsets = await graphGet<{ data?: Array<{ id: string; name?: string; status?: string }> }>(`${campaign.id}/adsets`, {
        fields: "id,name,status",
        limit: "50",
    });

    const adsetIds = adsets.data?.map((item) => item.id).filter(Boolean) || [];
    if (adsetIds.length === 0) {
        throw new ResponseError("meta_adsets_missing", "La campana de esta ciudad no tiene conjuntos de anuncios.", 502);
    }

    if (adsetIds.length > 1) {
        throw new ResponseError(
            "meta_multiple_adsets",
            `La campana ${campaign.name} tiene ${adsetIds.length} conjuntos de anuncios. Para este flujo de ciudad fija debe tener exactamente 1.`,
            409,
        );
    }

    const start = new Date();
    const end = calculateCycleEnd(start);
    const lifetimeBudget = Math.round(adsBudget * 100);
    const adsetId = adsetIds[0];
    const ads = await graphGet<{ data?: Array<{ id: string; name?: string; status?: string }> }>(`${adsetId}/ads`, {
        fields: "id,name,status",
        limit: "50",
    });
    const adIds = ads.data?.map((item) => item.id).filter(Boolean) || [];

    await graphPost(`${adsetId}`, {
        name: `TrackGo - ${cityName} - ${userId}`,
        lifetime_budget: lifetimeBudget,
        end_time: end.toISOString(),
        status: "ACTIVE",
    });

    await graphPost(`${campaign.id}`, { status: "ACTIVE" });

    return {
        campaignId: campaign.id,
        adsetIds: [adsetId],
        adIds,
        startDate: start,
        endDate: end,
        lifetimeBudget,
    };
}

export async function pauseCityCampaign({
    campaignId,
    adsetIds,
}: {
    campaignId: string;
    adsetIds?: string[];
}) {
    const campaign = await validateMetaCampaign(campaignId);
    const ids = adsetIds?.filter(Boolean).length
        ? adsetIds.filter(Boolean)
        : (
            await graphGet<{ data?: Array<{ id: string }> }>(`${campaign.id}/adsets`, {
                fields: "id",
                limit: "50",
            })
        ).data?.map((item) => item.id).filter(Boolean) || [];

    await Promise.all(ids.map((adsetId) => graphPost(`${adsetId}`, { status: "PAUSED" })));
    await graphPost(`${campaign.id}`, { status: "PAUSED" });

    return {
        campaignId: campaign.id,
        adsetIds: ids,
    };
}

export async function validateMetaCampaign(campaignId: string) {
    if (!campaignId.trim()) {
        throw new ResponseError("campaign_required", "El ID de campana Meta es obligatorio.");
    }

    const data = await graphGet<{
        id: string;
        name?: string;
        account_id?: string;
        effective_status?: string;
        status?: string;
    }>(campaignId.trim(), {
        fields: "id,name,account_id,effective_status,status",
    });

    const expectedAccount = metaConfig().adAccountId.trim().replace(/^act_/, "");
    const actualAccount = String(data.account_id || "").trim().replace(/^act_/, "");

    if (actualAccount && expectedAccount && actualAccount !== expectedAccount) {
        throw new ResponseError(
            "campaign_wrong_account",
            `La campana pertenece a otra cuenta publicitaria (${actualAccount}). Se esperaba ${expectedAccount}.`,
            409,
        );
    }

    return {
        id: data.id,
        name: data.name || "Campana sin nombre",
        accountId: data.account_id || null,
        status: data.effective_status || data.status || null,
    };
}

export async function validateCityCampaign(campaignId: string) {
    const campaign = await validateMetaCampaign(campaignId);
    const adsets = await graphGet<{ data?: Array<{ id: string; name?: string; status?: string }> }>(`${campaign.id}/adsets`, {
        fields: "id,name,status",
        limit: "50",
    });
    const adsetIds = adsets.data?.map((item) => item.id).filter(Boolean) || [];
    const ads =
        adsetIds.length === 1
            ? await graphGet<{ data?: Array<{ id: string; name?: string; status?: string }> }>(`${adsetIds[0]}/ads`, {
                fields: "id,name,status",
                limit: "50",
            })
            : { data: [] };
    const adIds = ads.data?.map((item) => item.id).filter(Boolean) || [];

    return {
        ...campaign,
        adsetsCount: adsetIds.length,
        adsetIds,
        adsCount: adIds.length,
        adIds,
        ready: adsetIds.length === 1,
        warning:
            adsetIds.length === 1
                ? null
                : adsetIds.length === 0
                    ? "La campana no tiene conjuntos de anuncios."
                    : `La campana tiene ${adsetIds.length} conjuntos de anuncios. Para este flujo debe tener exactamente 1.`,
    };
}
