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
        throw new ResponseError("meta_api_error", data.error?.message || "Meta no pudo completar la operacion.", 502);
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
        throw new ResponseError("meta_api_error", data.error?.message || "Meta no pudo consultar datos.", 502);
    }

    return data;
}

export async function duplicateAndActivateCampaign({
    baseCampaignId,
    cityName,
    userId,
    adsBudget,
}: {
    baseCampaignId: string;
    cityName: string;
    userId: string;
    adsBudget: number;
}) {
    const copy = await graphPost<{ copied_campaign_id?: string; id?: string }>(`${baseCampaignId}/copies`, {
        name: `TrackGo - ${cityName} - ${userId}`,
        status_option: "PAUSED",
        deep_copy: true,
    });

    const campaignId = copy.copied_campaign_id || copy.id;
    if (!campaignId) {
        throw new ResponseError("meta_campaign_copy_missing", "Meta no devolvio el ID de la campana copiada.", 502);
    }

    const adsets = await graphGet<{ data?: Array<{ id: string }> }>(`${campaignId}/adsets`, {
        fields: "id,name",
        limit: "50",
    });

    const adsetIds = adsets.data?.map((item) => item.id).filter(Boolean) || [];
    if (adsetIds.length === 0) {
        throw new ResponseError("meta_adsets_missing", "La campana copiada no tiene ad sets para configurar.", 502);
    }

    const start = new Date();
    const end = calculateCycleEnd(start);
    const lifetimeBudget = Math.round(adsBudget * 100);

    await Promise.all(
        adsetIds.map((adsetId) =>
            graphPost(`${adsetId}`, {
                lifetime_budget: lifetimeBudget,
                start_time: start.toISOString(),
                end_time: end.toISOString(),
                status: "ACTIVE",
            }),
        ),
    );

    await graphPost(`${campaignId}`, { status: "ACTIVE" });

    return {
        campaignId,
        adsetIds,
        startDate: start,
        endDate: end,
        lifetimeBudget,
    };
}

export async function validateMetaCampaign(baseCampaignId: string) {
    if (!baseCampaignId.trim()) {
        throw new ResponseError("base_campaign_required", "El ID de campana base es obligatorio.");
    }

    const data = await graphGet<{
        id: string;
        name?: string;
        account_id?: string;
        effective_status?: string;
        status?: string;
    }>(baseCampaignId.trim(), {
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
