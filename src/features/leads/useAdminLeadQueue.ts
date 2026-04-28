"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
    assignLeadToUser,
    getLeadQueuePage,
    updateLeadStatus,
} from "@/data/leadsRepo";
import { listAdminUsers } from "@/data/usersRepo";
import type {
    LeadCityOption,
    LeadFilters,
    LeadQueueCityFilter,
    LeadQueueCityField,
    LeadQueuePageCursor,
    LeadQueueStats,
    LeadReviewStatus,
    MetaLeadDoc,
} from "@/types/leads";
import type { UserDoc } from "@/types/users";

const EMPTY_FILTERS: LeadFilters = {
    status: "pending_review",
    city: "all",
    assignment: "all",
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
        lead.verificationStatus,
        lead.notSuitableReason,
        lead.location.displayLabel,
        lead.location.address,
        lead.location.mapsUrl,
        lead.lastInboundText,
        quickStatusText(lead),
    ]
        .map(norm)
        .join(" ")
        .includes(queryText);
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
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

function hasClientSideFilters(filters: LeadFilters) {
    return !!filters.search.trim() || filters.assignment !== "all";
}

function filterLeads(leads: MetaLeadDoc[], filters: LeadFilters) {
    const queryText = norm(filters.search);
    const queryDigits = phoneDigits(filters.search);

    return leads.filter((lead) => {
        if (filters.status !== "all" && lead.verificationStatus !== filters.status) {
            return false;
        }

        if (filters.city !== "all" && cityFilterValue(lead) !== filters.city) {
            return false;
        }

        const isAutoAssigned = !!lead.autoAssignedAt;
        if (filters.assignment === "auto" && !isAutoAssigned) return false;
        if (filters.assignment === "manual" && isAutoAssigned) return false;

        return leadMatchesSearch(lead, queryText, queryDigits);
    });
}

export function useAdminLeadQueue() {
    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
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

    const filteredLeads = useMemo(() => {
        return filterLeads(leads, filters);
    }, [filters, leads]);

    const stats = useMemo<LeadQueueStats>(() => {
        return {
            total: leads.length,
            pendingReview: leads.filter((lead) => lead.verificationStatus === "pending_review")
                .length,
            incomplete: leads.filter((lead) => lead.verificationStatus === "incomplete")
                .length,
            notSuitable: leads.filter((lead) => lead.verificationStatus === "not_suitable")
                .length,
            verified: leads.filter((lead) => lead.verificationStatus === "verified").length,
            outOfCoverage: leads.filter((lead) => lead.location.outOfCoverage).length,
        };
    }, [leads]);

    async function loadUsers() {
        setErr(null);

        try {
            const nextUsers = await listAdminUsers();
            setUsers(
                nextUsers.filter((user) => user.active && user.role === "user")
            );
        } catch (e: unknown) {
            setErr(errorMessage(e, "No se pudieron cargar los usuarios."));
        }
    }

    function queryStatuses(activeFilters: LeadFilters): LeadReviewStatus[] {
        return activeFilters.status === "all"
            ? ["pending_review", "incomplete", "not_suitable"]
            : [activeFilters.status];
    }

    function effectiveFilters(): LeadFilters {
        return {
            ...filters,
            search: deferredSearch,
        };
    }

    async function loadLeadsPage(reset = false, activeFilters = effectiveFilters()) {
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
                const page = await getLeadQueuePage({
                    cursor: nextCursor,
                    statuses: queryStatuses(activeFilters),
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
                setErr(errorMessage(e, "No se pudieron cargar los leads."));
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
            void loadUsers();
        });
    }, []);

    useEffect(() => {
        queueMicrotask(() => {
            void loadLeadsPage(true, effectiveFilters());
        });
        // Search and assignment filters are applied locally, but reset still uses a
        // larger page and backfills a few pages so large queues do not feel empty.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.status, filters.city, filters.assignment, deferredSearch]);

    async function setLeadStatus(lead: MetaLeadDoc, status: LeadReviewStatus) {
        setSavingId(lead.id);
        setErr(null);

        try {
            await updateLeadStatus(lead.id, {
                verificationStatus: status,
                leadQuality:
                    status === "verified"
                        ? "valid"
                        : status === "not_suitable"
                            ? "not_suitable"
                            : status === "pending_review"
                                ? "review"
                                : "unknown",
                notSuitableReason:
                    status === "not_suitable" ? lead.notSuitableReason || "Perfil no apto" : "",
                verifiedAt: status === "verified" ? Date.now() : null,
            });
            setLeads((prev) => {
                if (status === "verified") return prev.filter((item) => item.id !== lead.id);
                return prev.map((item) =>
                    item.id === lead.id
                        ? {
                            ...item,
                            verificationStatus: status,
                            notSuitableReason:
                                status === "not_suitable"
                                    ? item.notSuitableReason || "Perfil no apto"
                                    : null,
                        }
                        : item
                );
            });
        } catch (e: unknown) {
            setErr(errorMessage(e, "No se pudo cambiar el estado del lead."));
        } finally {
            setSavingId(null);
        }
    }

    async function assignLead(lead: MetaLeadDoc, userId: string) {
        if (!userId) return;

        setSavingId(lead.id);
        setErr(null);

        try {
            await updateLeadStatus(lead.id, {
                verificationStatus: "verified",
                leadQuality: "valid",
                notSuitableReason: "",
                verifiedAt: Date.now(),
            });
            await assignLeadToUser(lead.id, userId);
            setLeads((prev) => prev.filter((item) => item.id !== lead.id));
        } catch (e: unknown) {
            setErr(errorMessage(e, "No se pudo asignar el lead."));
        } finally {
            setSavingId(null);
        }
    }

    function resetFilters() {
        setFilters(EMPTY_FILTERS);
    }

    return {
        users,
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
        reloadUsers: loadUsers,
        reloadLeads: () => loadLeadsPage(true, effectiveFilters()),
        loadMore: () => loadLeadsPage(false, effectiveFilters()),
        setLeadStatus,
        assignLead,
    };
}
