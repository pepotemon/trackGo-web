import type { MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";

type CoverageType = "city" | "state" | "country";

type CoverageItem = {
    type: CoverageType;
    cityLabel: string;
    cityNormalized: string;
    stateLabel: string;
    stateNormalized: string;
    countryLabel: string;
    countryNormalized: string;
    displayLabel: string;
    active: boolean;
};

export type LeadCoverageMatch = {
    user: UserDoc;
    leads: MetaLeadDoc[];
};

function s(value: unknown) {
    return String(value ?? "").trim();
}

function sn(value: unknown) {
    return s(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\s\-/]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function coverageType(value: unknown): CoverageType | null {
    const type = sn(value);
    if (type === "city" || type === "state" || type === "country") return type;
    return null;
}

function getUserCoverage(user: UserDoc): CoverageItem[] {
    const raw = Array.isArray(user.geoCoverage) ? user.geoCoverage : [];

    return raw
        .map(record)
        .map((item) => {
            const type = coverageType(item.type);
            if (!type) return null;

            return {
                type,
                cityLabel: s(item.cityLabel),
                cityNormalized: sn(item.cityNormalized),
                stateLabel: s(item.stateLabel),
                stateNormalized: sn(item.stateNormalized),
                countryLabel: s(item.countryLabel || "Brasil"),
                countryNormalized: sn(item.countryNormalized || "brasil"),
                displayLabel: s(item.displayLabel),
                active: item.active !== false,
            };
        })
        .filter((item): item is CoverageItem => !!item && item.active);
}

export function userCoverageLabel(user: UserDoc) {
    const primary = s((user as { primaryGeoCoverageLabel?: unknown }).primaryGeoCoverageLabel);
    if (primary) return primary;

    const items = getUserCoverage(user);
    if (!items.length) return "Sin cobertura";

    return items
        .slice(0, 2)
        .map((item) =>
            item.displayLabel ||
            item.cityLabel ||
            item.stateLabel ||
            item.countryLabel ||
            item.type
        )
        .filter(Boolean)
        .join(" - ");
}

function leadCountry(lead: MetaLeadDoc) {
    const marketCountry = s(lead.raw.marketCountry);
    return (
        sn(lead.location.adminCountryNormalized) ||
        sn(lead.raw.marketCountryNormalized) ||
        (marketCountry === "PA" ? "panama" : "brasil")
    );
}

export function userMatchesLead(user: UserDoc, lead: MetaLeadDoc) {
    if (!user.active || user.role !== "user") return false;

    const coverage = getUserCoverage(user);
    if (!coverage.length) return false;

    const leadAdminCity = sn(lead.location.adminCityNormalized);
    const leadAdminState = sn(lead.location.adminStateNormalized);
    const leadAdminCountry = leadCountry(lead);
    const leadHubCity = sn(lead.location.cityNormalized);

    return coverage.some((item) => {
        if (item.type === "city") {
            const cityMatch =
                (!!leadAdminCity && item.cityNormalized === leadAdminCity) ||
                (!!leadHubCity && item.cityNormalized === leadHubCity);

            if (!cityMatch) return false;
            if (
                item.countryNormalized &&
                leadAdminCountry &&
                item.countryNormalized !== leadAdminCountry
            ) {
                return false;
            }

            if (item.stateNormalized && leadAdminState) {
                return item.stateNormalized === leadAdminState;
            }

            return true;
        }

        if (item.type === "state") {
            if (!item.stateNormalized || !leadAdminState) return false;
            if (
                item.countryNormalized &&
                leadAdminCountry &&
                item.countryNormalized !== leadAdminCountry
            ) {
                return false;
            }
            return item.stateNormalized === leadAdminState;
        }

        if (item.type === "country") {
            if (!item.countryNormalized || !leadAdminCountry) return false;
            return item.countryNormalized === leadAdminCountry;
        }

        return false;
    });
}

export function buildCoverageMatches(
    leads: MetaLeadDoc[],
    users: UserDoc[]
): LeadCoverageMatch[] {
    return users
        .filter((user) => user.active && user.role === "user")
        .map((user) => ({
            user,
            leads: leads.filter((lead) => userMatchesLead(user, lead)),
        }))
        .filter((match) => match.leads.length > 0)
        .sort((a, b) => {
            const aName = s(a.user.name) || s(a.user.email);
            const bName = s(b.user.name) || s(b.user.email);
            return aName.localeCompare(bName, "es", { sensitivity: "base" });
        });
}

