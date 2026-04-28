"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
    dayKeyFromDate,
    getAutoAssignLogPage,
} from "@/data/autoAssignLogsRepo";
import { listAdminUsers } from "@/data/usersRepo";
import type {
    AutoAssignLogDoc,
    AutoAssignLogFilters,
    AutoAssignLogPageCursor,
} from "@/types/leads";
import type { UserDoc } from "@/types/users";

const DEFAULT_PAGE_SIZE = 80;
const FILTERED_PAGE_SIZE = 150;
const MIN_FILTERED_RESULTS = 50;
const MAX_AUTO_FETCH_PAGES = 4;

const EMPTY_FILTERS: AutoAssignLogFilters = {
    dayKey: dayKeyFromDate(new Date()),
    userId: "all",
    matchType: "all",
    search: "",
};

function norm(value: unknown) {
    return String(value ?? "").toLowerCase().trim();
}

function digits(value: unknown) {
    return String(value ?? "").replace(/\D+/g, "");
}

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function logMatchesSearch(log: AutoAssignLogDoc, queryText: string, queryDigits: string) {
    if (!queryText && !queryDigits) return true;

    if (queryDigits && digits(log.leadPhone).includes(queryDigits)) return true;

    return [
        log.id,
        log.leadId,
        log.leadName,
        log.leadBusiness,
        log.leadGeoAdminDisplayLabel,
        log.leadGeoAdminCityLabel,
        log.leadGeoAdminStateLabel,
        log.leadGeoHubLabel,
        log.userId,
        log.userName,
        log.userCoverageLabel,
        log.matchType,
        log.coverageKey,
        log.mode,
    ]
        .map(norm)
        .join(" ")
        .includes(queryText);
}

function filterLogs(logs: AutoAssignLogDoc[], filters: AutoAssignLogFilters) {
    const queryText = norm(filters.search);
    const queryDigits = digits(filters.search);

    return logs.filter((log) => logMatchesSearch(log, queryText, queryDigits));
}

function hasClientSideFilters(filters: AutoAssignLogFilters) {
    return !!filters.search.trim();
}

export function useAutoAssignLogs() {
    const [logs, setLogs] = useState<AutoAssignLogDoc[]>([]);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [filters, setFilters] = useState<AutoAssignLogFilters>(EMPTY_FILTERS);
    const deferredSearch = useDeferredValue(filters.search);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [cursor, setCursor] = useState<AutoAssignLogPageCursor | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const requestSeq = useRef(0);

    const effectiveFilters = useMemo<AutoAssignLogFilters>(() => ({
        ...filters,
        search: deferredSearch,
    }), [deferredSearch, filters]);

    const filteredLogs = useMemo(() => filterLogs(logs, filters), [filters, logs]);

    const stats = useMemo(() => {
        const userIds = new Set(logs.map((log) => log.userId).filter(Boolean));

        return {
            total: logs.length,
            users: userIds.size,
            city: logs.filter((log) => log.matchType === "city").length,
            hubCity: logs.filter((log) => log.matchType === "hub_city").length,
            state: logs.filter((log) => log.matchType === "state").length,
            country: logs.filter((log) => log.matchType === "country").length,
        };
    }, [logs]);

    async function loadUsers() {
        try {
            const nextUsers = await listAdminUsers();
            setUsers(nextUsers.filter((user) => user.role === "user"));
        } catch {
            setUsers([]);
        }
    }

    async function loadLogPage(reset = false, activeFilters = effectiveFilters) {
        const requestId = ++requestSeq.current;
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
            const base = reset ? [] : logs;
            const map = new Map(base.map((log) => [log.id, log]));
            let nextCursor = reset ? null : cursor;
            let nextHasMore = true;
            let pagesFetched = 0;

            while (nextHasMore && pagesFetched < MAX_AUTO_FETCH_PAGES) {
                const page = await getAutoAssignLogPage({
                    cursor: nextCursor,
                    dayKey: activeFilters.dayKey,
                    userId: activeFilters.userId === "all" ? "" : activeFilters.userId,
                    matchType: activeFilters.matchType,
                    pageSize,
                });

                for (const item of page.items) {
                    map.set(item.id, item);
                }

                nextCursor = page.cursor;
                nextHasMore = page.hasMore;
                pagesFetched += 1;

                const visible = filterLogs(Array.from(map.values()), activeFilters).length;
                const shouldKeepFilling =
                    reset &&
                    hasClientSideFilters(activeFilters) &&
                    visible < MIN_FILTERED_RESULTS;

                if (!shouldKeepFilling) break;
            }

            if (requestId === requestSeq.current) {
                setLogs(Array.from(map.values()));
                setCursor(nextCursor);
                setHasMore(nextHasMore);
            }
        } catch (e: unknown) {
            if (requestId === requestSeq.current) {
                setErr(errorMessage(e, "No se pudieron cargar las asignaciones."));
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
            void loadLogPage(true, effectiveFilters);
        });
        // Search is deferred so Firestore does not receive a request per keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.dayKey, filters.userId, filters.matchType, deferredSearch]);

    function resetFilters() {
        setFilters(EMPTY_FILTERS);
    }

    return {
        users,
        filters,
        filteredLogs,
        stats,
        loading,
        loadingMore,
        hasMore,
        err,
        setFilters,
        resetFilters,
        reloadLogs: () => loadLogPage(true, effectiveFilters),
        loadMore: () => loadLogPage(false, effectiveFilters),
    };
}
