"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
    getLeadHistoryPage,
    reopenLeadForReview,
} from "@/data/leadsRepo";
import type {
    LeadCityOption,
    LeadHistoryBucket,
    LeadHistoryFilters,
    LeadQueueCityFilter,
    LeadQueueCityField,
    LeadQueuePageCursor,
    MetaLeadDoc,
} from "@/types/leads";

const EMPTY_FILTERS: LeadHistoryFilters = {
    bucket: "all",
    city: "all",
    search: "",
};

const DEFAULT_PAGE_SIZE = 80;
const FILTERED_PAGE_SIZE = 150;
const MIN_FILTERED_RESULTS = 50;
const MAX_AUTO_FETCH_PAGES = 4;

const CITY_FILTER_FIELDS = new Set<LeadQueueCityField>([
    "geoAdminCityNormalized",
    "geoCityNormalized",
    "geoAdminStateNormalized",
]);

function norm(value: unknown) {
    return String(value ?? "").toLowerCase().trim();
}

function phoneDigits(value: unknown) {
    return String(value ?? "").replace(/\D+/g, "");
}

function quickStatusText(lead: MetaLeadDoc) {
    return typeof lead.raw.quickStatusText === "string" ? lead.raw.quickStatusText : "";
}

function cityFilterValue(lead: MetaLeadDoc) {
    if (lead.location.adminCityNormalized) {
        return `geoAdminCityNormalized:${lead.location.adminCityNormalized}`;
    }

    if (lead.location.cityNormalized) {
        return `geoCityNormalized:${lead.location.cityNormalized}`;
    }

    if (lead.location.adminStateNormalized) {
        return `geoAdminStateNormalized:${lead.location.adminStateNormalized}`;
    }

    return "unknown";
}

function cityLabel(lead: MetaLeadDoc) {
    return (
        lead.location.displayLabel ||
        lead.location.adminCityLabel ||
        lead.location.cityLabel ||
        lead.location.adminStateLabel ||
        "Sin ciudad"
    );
}

function leadMatchesSearch(lead: MetaLeadDoc, queryText: string, queryDigits: string) {
    if (!queryText && !queryDigits) return true;

    if (queryDigits && phoneDigits(lead.phone).includes(queryDigits)) return true;

    return [
        lead.id,
        lead.name,
        lead.business,
        lead.phone,
        lead.waId,
        lead.notSuitableReason,
        lead.location.displayLabel,
        lead.location.address,
        lead.lastInboundText,
        quickStatusText(lead),
    ]
        .map(norm)
        .join(" ")
        .includes(queryText);
}

function parseCityFilter(value: string): LeadQueueCityFilter | null {
    const [field, ...rest] = value.split(":");
    const cityValue = rest.join(":").trim();

    if (!CITY_FILTER_FIELDS.has(field as LeadQueueCityField) || !cityValue) {
        return null;
    }

    return {
        field: field as LeadQueueCityField,
        value: cityValue,
    };
}

function hasClientSideFilters(filters: LeadHistoryFilters) {
    return !!filters.search.trim();
}

function filterLeads(leads: MetaLeadDoc[], filters: LeadHistoryFilters) {
    const queryText = norm(filters.search);
    const queryDigits = phoneDigits(filters.search);

    return leads.filter((lead) => {
        if (filters.bucket !== "all" && lead.verificationStatus !== filters.bucket) {
            return false;
        }

        if (filters.city !== "all" && cityFilterValue(lead) !== filters.city) {
            return false;
        }

        return leadMatchesSearch(lead, queryText, queryDigits);
    });
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

export function useAdminLeadHistory() {
    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [filters, setFilters] = useState<LeadHistoryFilters>(EMPTY_FILTERS);
    const deferredSearch = useDeferredValue(filters.search);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [cursor, setCursor] = useState<LeadQueuePageCursor | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const requestSeq = useRef(0);

    const cityOptions = useMemo<LeadCityOption[]>(() => {
        const map = new Map<string, string>();

        for (const lead of leads) {
            map.set(cityFilterValue(lead), cityLabel(lead));
        }

        return Array.from(map.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label, "es"));
    }, [leads]);

    const effectiveFilters = useMemo<LeadHistoryFilters>(() => ({
        ...filters,
        search: deferredSearch,
    }), [deferredSearch, filters]);

    const filteredLeads = useMemo(() => {
        return filterLeads(leads, filters);
    }, [filters, leads]);

    const stats = useMemo(() => {
        return {
            total: leads.length,
            incomplete: leads.filter((lead) => lead.verificationStatus === "incomplete").length,
            notSuitable: leads.filter((lead) => lead.verificationStatus === "not_suitable").length,
        };
    }, [leads]);

    function buckets(activeFilters: LeadHistoryFilters): LeadHistoryBucket[] {
        return activeFilters.bucket === "all"
            ? ["incomplete", "not_suitable"]
            : [activeFilters.bucket];
    }

    async function loadHistoryPage(reset = false, activeFilters = effectiveFilters) {
        const requestId = ++requestSeq.current;
        const city = parseCityFilter(activeFilters.city);
        const pageSize = hasClientSideFilters(activeFilters)
            ? FILTERED_PAGE_SIZE
            : DEFAULT_PAGE_SIZE;

        if (reset) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }

        setErr(null);

        try {
            const base = reset ? [] : leads;
            const map = new Map(base.map((lead) => [lead.id, lead]));
            let nextCursor = reset ? null : cursor;
            let nextHasMore = true;
            let pagesFetched = 0;

            while (nextHasMore && pagesFetched < MAX_AUTO_FETCH_PAGES) {
                const page = await getLeadHistoryPage({
                    cursor: nextCursor,
                    buckets: buckets(activeFilters),
                    city,
                    pageSize,
                });

                for (const lead of page.items) {
                    map.set(lead.id, lead);
                }

                nextCursor = page.cursor;
                nextHasMore = page.hasMore;
                pagesFetched += 1;

                const visible = filterLeads(Array.from(map.values()), activeFilters).length;
                const shouldKeepFilling =
                    reset &&
                    hasClientSideFilters(activeFilters) &&
                    visible < MIN_FILTERED_RESULTS;

                if (!shouldKeepFilling) break;
            }

            if (requestId === requestSeq.current) {
                setLeads(Array.from(map.values()));
                setCursor(nextCursor);
                setHasMore(nextHasMore);
            }
        } catch (e: unknown) {
            if (requestId === requestSeq.current) {
                setErr(errorMessage(e, "No se pudo cargar el historial."));
            }
        } finally {
            if (requestId === requestSeq.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }

    useEffect(() => {
        queueMicrotask(() => {
            void loadHistoryPage(true, effectiveFilters);
        });
        // Search is deferred so Firestore does not receive one request per keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.bucket, filters.city, deferredSearch]);

    async function reopenLead(lead: MetaLeadDoc) {
        setSavingId(lead.id);
        setErr(null);

        try {
            await reopenLeadForReview(lead.id);
            setLeads((prev) => prev.filter((item) => item.id !== lead.id));
        } catch (e: unknown) {
            setErr(errorMessage(e, "No se pudo reabrir el lead."));
        } finally {
            setSavingId(null);
        }
    }

    function resetFilters() {
        setFilters(EMPTY_FILTERS);
    }

    return {
        filters,
        filteredLeads,
        cityOptions,
        stats,
        loading,
        loadingMore,
        hasMore,
        savingId,
        err,
        setFilters,
        resetFilters,
        reloadHistory: () => loadHistoryPage(true, effectiveFilters),
        loadMore: () => loadHistoryPage(false, effectiveFilters),
        reopenLead,
    };
}
