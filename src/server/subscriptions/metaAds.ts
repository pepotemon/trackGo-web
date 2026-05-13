import { ResponseError } from "@/server/auth";
import { calculateAdsBudgetAllocation, calculateCycleEnd } from "@/server/subscriptions/plans";

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
    cycleDays = 5,
}: {
    campaignId: string;
    cityName: string;
    userId: string;
    adsBudget: number;
    cycleDays?: number;
}) {
    const campaign = await validateMetaCampaign(campaignId);
    const spendBaseline = await getMetaCampaignTotalSpend(campaign.id).catch(() => 0);
    const adsets = await graphGet<{ data?: Array<{ id: string; name?: string; status?: string; daily_budget?: string; lifetime_budget?: string }> }>(`${campaign.id}/adsets`, {
        fields: "id,name,status,daily_budget,lifetime_budget",
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
    const end = calculateCycleEnd(start, cycleDays);
    const budgetAllocation = calculateAdsBudgetAllocation(adsBudget, cycleDays);
    if (budgetAllocation.dailyBudgetMinorUnits <= 0) {
        throw new ResponseError("invalid_ads_budget", "El presupuesto operativo para Meta debe ser mayor a cero.");
    }
    const adsetId = adsetIds[0];
    const ads = await graphGet<{ data?: Array<{ id: string; name?: string; status?: string }> }>(`${adsetId}/ads`, {
        fields: "id,name,status",
        limit: "50",
    });
    const adIds = ads.data?.map((item) => item.id).filter(Boolean) || [];

    await graphPost(`${adsetId}`, {
        name: `TrackGo - ${cityName} - ${userId}`,
        daily_budget: budgetAllocation.dailyBudgetMinorUnits,
        status: "ACTIVE",
    });

    await graphPost(`${campaign.id}`, { status: "ACTIVE" });

    return {
        campaignId: campaign.id,
        adsetIds: [adsetId],
        adIds,
        startDate: start,
        endDate: end,
        dailyBudget: budgetAllocation.dailyBudget,
        operatingBudget: budgetAllocation.operatingBudget,
        reservedBudget: budgetAllocation.reservedBudget,
        totalBudget: budgetAllocation.totalBudget,
        dailyBudgetMinorUnits: budgetAllocation.dailyBudgetMinorUnits,
        lifetimeBudget: null,
        budgetMode: "daily",
        reservePercent: budgetAllocation.reservePercent,
        targetSpend: budgetAllocation.totalBudget,
        spendPauseThreshold: Math.round(budgetAllocation.totalBudget * 0.98 * 100) / 100,
        spendBaseline,
    };
}

export async function getMetaCampaignTotalSpend(campaignId: string) {
    const campaign = await validateMetaCampaign(campaignId);
    const insights = await graphGet<{ data?: Array<{ spend?: string }> }>(`${campaign.id}/insights`, {
        fields: "spend",
        date_preset: "maximum",
    });
    const spend = Number(insights.data?.[0]?.spend || 0);
    return Number.isFinite(spend) ? Math.round(spend * 100) / 100 : 0;
}

export async function getMetaCampaignSpendForRange(input: {
    campaignId: string;
    since: string;
    until: string;
}) {
    const campaign = await validateMetaCampaign(input.campaignId);
    const insights = await graphGet<{ data?: Array<{ spend?: string }> }>(`${campaign.id}/insights`, {
        fields: "spend",
        time_range: JSON.stringify({ since: input.since, until: input.until }),
    });
    const spend = Number(insights.data?.[0]?.spend || 0);
    return Number.isFinite(spend) ? Math.round(spend * 100) / 100 : 0;
}

export async function getMetaCampaignCycleSpend(input: {
    campaignId: string;
    spendBaseline?: number | null;
}) {
    const totalSpend = await getMetaCampaignTotalSpend(input.campaignId);
    const baseline = Number(input.spendBaseline || 0);
    const cycleSpend = Math.max(0, totalSpend - (Number.isFinite(baseline) ? baseline : 0));
    return {
        totalSpend,
        spendBaseline: Number.isFinite(baseline) ? baseline : 0,
        cycleSpend: Math.round(cycleSpend * 100) / 100,
    };
}

export async function pauseCityCampaign({
    campaignId,
    adsetIds,
}: {
    campaignId: string;
    adsetIds?: string[];
}) {
    return setCityCampaignDeliveryStatus({ campaignId, adsetIds, status: "PAUSED" });
}

export async function resumeCityCampaign({
    campaignId,
    adsetIds,
}: {
    campaignId: string;
    adsetIds?: string[];
}) {
    return setCityCampaignDeliveryStatus({ campaignId, adsetIds, status: "ACTIVE" });
}

async function setCityCampaignDeliveryStatus({
    campaignId,
    adsetIds,
    status,
}: {
    campaignId: string;
    adsetIds?: string[];
    status: "ACTIVE" | "PAUSED";
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

    await Promise.all(ids.map((adsetId) => graphPost(`${adsetId}`, { status })));
    await graphPost(`${campaign.id}`, { status });

    return {
        campaignId: campaign.id,
        adsetIds: ids,
        status,
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
    const adsets = await graphGet<{
        data?: Array<{
            id: string;
            name?: string;
            status?: string;
            effective_status?: string;
            start_time?: string;
            end_time?: string;
            daily_budget?: string;
            lifetime_budget?: string;
        }>;
    }>(`${campaign.id}/adsets`, {
        fields: "id,name,status,effective_status,start_time,end_time,daily_budget,lifetime_budget",
        limit: "50",
    });
    const adsetIds = adsets.data?.map((item) => item.id).filter(Boolean) || [];
    const primaryAdset = adsets.data?.[0] || null;
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
        primaryAdset: primaryAdset
            ? {
                id: primaryAdset.id,
                name: primaryAdset.name || null,
                status: primaryAdset.effective_status || primaryAdset.status || null,
                startTime: primaryAdset.start_time || null,
                endTime: primaryAdset.end_time || null,
                dailyBudget: centsToMoney(primaryAdset.daily_budget),
                lifetimeBudget: centsToMoney(primaryAdset.lifetime_budget),
                budgetMode: Number(primaryAdset.daily_budget || 0) > 0 && Number(primaryAdset.lifetime_budget || 0) <= 0
                    ? "daily"
                    : "lifetime",
            }
            : null,
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

export async function getActiveCityCampaignSnapshot(campaignId: string) {
    const campaign = await validateCityCampaign(campaignId);
    if (!campaign.ready || !campaign.primaryAdset) {
        throw new ResponseError("campaign_not_ready", campaign.warning || "La campana no esta lista para sincronizar.", 409);
    }

    const campaignStatus = String(campaign.status || "").toUpperCase();
    const adsetStatus = String(campaign.primaryAdset.status || "").toUpperCase();
    if (campaignStatus && !["ACTIVE", "IN_PROCESS", "WITH_ISSUES"].includes(campaignStatus)) {
        throw new ResponseError("campaign_not_active", `La campana en Meta no esta activa (${campaign.status}).`, 409);
    }
    if (adsetStatus && !["ACTIVE", "IN_PROCESS", "WITH_ISSUES"].includes(adsetStatus)) {
        throw new ResponseError("adset_not_active", `El conjunto de anuncios no esta activo (${campaign.primaryAdset.status}).`, 409);
    }

    const now = new Date();
    const endDate = campaign.primaryAdset.endTime ? new Date(campaign.primaryAdset.endTime) : calculateCycleEnd(now, 5);
    const safeEndDate = Number.isNaN(endDate.getTime()) || endDate.getTime() <= Date.now()
        ? calculateCycleEnd(now, 5)
        : endDate;

    return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignStatus: campaign.status,
        adsetIds: campaign.adsetIds,
        adIds: campaign.adIds,
        adset: campaign.primaryAdset,
        startDate: now,
        endDate: safeEndDate,
        spendBaseline: await getMetaCampaignTotalSpend(campaign.id).catch(() => 0),
    };
}

function centsToMoney(value?: string) {
    const cents = Number(value || 0);
    if (!Number.isFinite(cents) || cents <= 0) return null;
    return Math.round(cents) / 100;
}
