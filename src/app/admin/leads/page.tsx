"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dayKeyFromDate, weekRangeKeysMonToSun } from "@/lib/date";
import {
    buildCoverageMatches,
    userCoverageLabel,
} from "@/features/leads/coverageMatching";
import { LeadQuickAccessCards } from "@/features/leads/LeadQuickAccessCards";
import { LeadEditModal } from "@/features/leads/LeadEditModal";
import { AssignUserModal } from "@/features/leads/AssignUserModal";
import { useAdminLeadQueue } from "@/features/leads/useAdminLeadQueue";
import { deleteLead } from "@/data/leadsRepo";
import type { LeadFilters, LeadReviewStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import {
    ActionTile,
    ActionTileButton,
    AppIcon,
    Badge,
    Button,
    Card,
    Input,
    KpiCard,
    Modal,
    PageHeader,
} from "@/components/ui";

const STATUS_OPTIONS: { value: LeadReviewStatus; label: string }[] = [
    { value: "pending_review", label: "Por revisar" },
    { value: "incomplete", label: "Incompleto" },
    { value: "not_suitable", label: "No apto" },
    { value: "verified", label: "Verificado" },
];

const statusLabel: Record<LeadReviewStatus, string> = {
    pending_review: "Por revisar",
    incomplete: "Incompleto",
    not_suitable: "No apto",
    verified: "Verificado",
};

const statusTone: Record<LeadReviewStatus, "yellow" | "gray" | "red" | "green"> = {
    pending_review: "yellow",
    incomplete: "gray",
    not_suitable: "red",
    verified: "green",
};

function selectClassName(extra = "") {
    return [
        "h-10 rounded-[15px] border border-white/[0.08] bg-[#0F172A] px-3 text-[13px] font-bold text-[#F9FAFB] outline-none transition focus:border-blue-400/35 focus:ring-2 focus:ring-blue-400/10 sm:h-9 sm:rounded-lg sm:text-[12px] xl:border-[#e5e7eb] xl:bg-white xl:font-semibold xl:text-[#52525b] xl:focus:border-[#7c3aed] xl:focus:ring-violet-100",
        extra,
    ].join(" ");
}

function formatDate(value?: number | null) {
    if (!value) return "Sin fecha";
    return new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function formatDateShort(value?: number | null) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("es", {
        day: "2-digit",
        month: "2-digit",
    }).format(new Date(value));
}

function displayName(lead: MetaLeadDoc) {
    return lead.name || lead.phone || "Lead";
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

function mobileCityName(lead: MetaLeadDoc): string {
    const city =
        lead.location.adminCityLabel ||
        lead.location.cityLabel ||
        "";
    if (city) return city;
    const full = lead.location.displayLabel || "";
    if (!full) return "Sin ciudad";
    const dash = full.lastIndexOf(" - ");
    return dash > 0 ? full.slice(0, dash) : full;
}

function quickStatus(lead: MetaLeadDoc) {
    return typeof lead.raw.quickStatusText === "string"
        ? lead.raw.quickStatusText
        : "";
}

function hasNewInbound(lead: MetaLeadDoc) {
    const inbound = lead.lastInboundMessageAt ?? 0;
    const seen = Math.max(
        lead.adminQueueLastSeenMessageAt ?? 0,
        lead.adminQueueSeenAt ?? 0
    );
    return inbound > seen;
}

function whatsappUrl(phone?: string | null) {
    const clean = String(phone ?? "").replace(/\D+/g, "");
    if (!clean) return "";
    return `https://wa.me/${clean}?text=${encodeURIComponent(
        "Olá! Estou entrando em contato sobre seu cadastro 🙌"
    )}`;
}

export default function AdminLeadsPage() {
    const [coverageOpen, setCoverageOpen] = useState(false);
    const [editingLead, setEditingLead] = useState<MetaLeadDoc | null>(null);
    const [quickLead, setQuickLead] = useState<MetaLeadDoc | null>(null);
    const [viewMode, setViewMode] = useState<"day" | "week">("week");
    const [assigningLead, setAssigningLead] = useState<MetaLeadDoc | null>(null);

    const {
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
        reloadUsers,
        reloadLeads,
        loadMore,
        assignLead,
    } = useAdminLeadQueue();

    async function handleAssignLead(lead: MetaLeadDoc, userId: string) {
        await assignLead(lead, userId);
        setAssigningLead(null);
    }

    async function handleDeleteLead(lead: MetaLeadDoc) {
        const ok = window.confirm(`¿Eliminar el lead "${displayName(lead)}"? Esta acción no se puede deshacer.`);
        if (!ok) return;

        try {
            await deleteLead(lead.id);
            setQuickLead(null);
            reloadLeads();
        } catch {
            // silently ignore; reloadLeads will refresh the list
        }
    }

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (filters.status !== "pending_review") total++;
        if (filters.city !== "all") total++;
        if (filters.assignment !== "all") total++;
        if (filters.search.trim()) total++;
        if (filters.startKey) total++;
        if (filters.endKey) total++;
        return total;
    }, [filters]);

    function patchFilters(patch: Partial<LeadFilters>) {
        setFilters((prev) => ({ ...prev, ...patch }));
    }

    function changeViewMode(mode: "day" | "week") {
        setViewMode(mode);
        if (mode === "day") {
            const today = dayKeyFromDate(new Date());
            patchFilters({ startKey: today, endKey: today });
        } else {
            const { startKey, endKey } = weekRangeKeysMonToSun();
            patchFilters({ startKey, endKey });
        }
    }

    useEffect(() => {
        const query = new URLSearchParams(window.location.search)
            .get("search")
            ?.trim();
        if (!query) return;
        setFilters((prev) => ({ ...prev, search: query }));
    }, [setFilters]);

    useEffect(() => {
        if (!loading && filteredLeads.length > 0) {
            try {
                sessionStorage.setItem(
                    "leads_mobile_queue",
                    JSON.stringify(filteredLeads.map((l) => l.id))
                );
            } catch { }
        }
    }, [filteredLeads, loading]);

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <div className="xl:hidden">
                <MobileLeadQueue
                    leads={filteredLeads}
                    stats={stats}
                    filters={filters}
                    cityOptions={cityOptions}
                    loading={loading}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    savingId={savingId}
                    activeFiltersCount={activeFiltersCount}
                    onPatchFilters={patchFilters}
                    onResetFilters={resetFilters}
                    onReloadUsers={reloadUsers}
                    onLoadMore={loadMore}
                    onOpenCoverage={() => setCoverageOpen(true)}
                    onOpenEdit={setEditingLead}
                    onDelete={handleDeleteLead}
                    onOpenAssign={setAssigningLead}
                    viewMode={viewMode}
                    onChangeViewMode={changeViewMode}
                />
            </div>

            <div className="hidden xl:block">
                <PageHeader
                    title="Leads"
                    subtitle="Gestiona, valida y asigna leads de forma eficiente."
                    icon={
                        <AppIcon
                            name="lead"
                            tone="purple"
                            size="sm"
                            className="bg-transparent text-white ring-0"
                        />
                    }
                    actions={
                        <div className="grid w-full grid-cols-[1fr_44px] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                            <Button
                                onClick={() => setCoverageOpen(true)}
                                disabled={loading || !filteredLeads.length}
                                className="w-full sm:w-auto"
                            >
                                <AppIcon
                                    name="link"
                                    tone="purple"
                                    size="sm"
                                    className="h-5 w-5 rounded-md bg-transparent text-current ring-0"
                                />
                                <span className="sm:inline">Asignar por cobertura</span>
                            </Button>

                            <Button
                                variant="primary"
                                onClick={reloadUsers}
                                disabled={loading}
                                aria-label="Actualizar usuarios"
                                title="Actualizar usuarios"
                                className="h-10 w-10 px-0 py-0"
                            >
                                <AppIcon
                                    name="refresh"
                                    tone="purple"
                                    size="sm"
                                    className="bg-transparent text-white ring-0"
                                />
                            </Button>
                        </div>
                    }
                />

                {err ? (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                        {err}
                    </div>
                ) : null}

                <LeadQuickAccessCards />

                <section className="mb-4 grid grid-cols-4 gap-4">
                    <KpiCard label="Cola activa" value={stats.total} caption="Leads Meta sin asignar" icon="users" tone="blue" />
                    <KpiCard label="Por revisar" value={stats.pendingReview} caption="Listos para validar" icon="lead" tone="purple" />
                    <KpiCard label="Incompletos" value={stats.incomplete} caption="Falta negocio o maps" icon="alert" tone="orange" />
                    <KpiCard label="No aptos" value={stats.notSuitable} caption="Descartados operativos" icon="close" tone="red" />
                </section>

                <Card className="overflow-hidden">
                    <div className="flex flex-col gap-3 bg-gradient-to-b from-white to-[#fbfaff] px-4 py-4">
                        <div className="flex flex-row items-center justify-between gap-3">
                            <div>
                                <h2 className="text-[14px] font-semibold text-[#171717]">
                                    Cola de revisión
                                </h2>
                                <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                    {filteredLeads.length} visibles de {stats.total}
                                </p>
                            </div>

                            <Input
                                value={filters.search}
                                onChange={(e) => patchFilters({ search: e.target.value })}
                                placeholder="Buscar lead, teléfono, negocio, ciudad..."
                                className="w-[360px]"
                            />
                        </div>

                        <div className="grid grid-cols-5 gap-2">
                            <FilterSelect
                                label="Estado"
                                value={filters.status}
                                onChange={(value) =>
                                    patchFilters({ status: value as LeadFilters["status"] })
                                }
                            >
                                <option value="all">Todos los estados</option>
                                {STATUS_OPTIONS.filter((status) => status.value !== "verified").map((status) => (
                                    <option key={status.value} value={status.value}>
                                        {status.label}
                                    </option>
                                ))}
                            </FilterSelect>

                            <FilterSelect
                                label="Ciudad"
                                value={filters.city}
                                onChange={(value) => patchFilters({ city: value })}
                            >
                                <option value="all">Todas las ciudades</option>
                                {cityOptions.map((city) => (
                                    <option key={city.value} value={city.value}>
                                        {city.label}
                                    </option>
                                ))}
                            </FilterSelect>

                            <FilterSelect
                                label="Asignación"
                                value={filters.assignment}
                                onChange={(value) =>
                                    patchFilters({
                                        assignment: value as LeadFilters["assignment"],
                                    })
                                }
                            >
                                <option value="all">Manual y auto</option>
                                <option value="auto">Auto-asignados</option>
                                <option value="manual">Manuales</option>
                            </FilterSelect>

                            <FilterDate
                                label="Desde"
                                value={filters.startKey}
                                onChange={(value) => patchFilters({ startKey: value })}
                            />

                            <FilterDate
                                label="Hasta"
                                value={filters.endKey}
                                onChange={(value) => patchFilters({ endKey: value })}
                            />
                        </div>

                        {activeFiltersCount > 0 ? (
                            <div className="flex justify-end">
                                <Button onClick={resetFilters}>Limpiar filtros</Button>
                            </div>
                        ) : null}
                    </div>

                    <LeadsTable
                        leads={filteredLeads}
                        loading={loading}
                        savingId={savingId}
                        onQuickActions={setQuickLead}
                    />

                    <div className="flex items-center justify-between gap-3 border-t border-[#f0f1f2] px-4 py-3">
                        <p className="text-[12px] font-medium text-[#9ca3af]">
                            {filteredLeads.length} leads cargados en esta vista
                        </p>
                        {hasMore ? (
                            <Button onClick={loadMore} disabled={loadingMore}>
                                {loadingMore ? "Cargando..." : "Cargar más"}
                            </Button>
                        ) : null}
                    </div>
                </Card>
            </div>

            <CoverageAssignModal
                open={coverageOpen}
                onClose={() => setCoverageOpen(false)}
                leads={filteredLeads}
                users={users}
                savingId={savingId}
                onAssign={assignLead}
            />

            <LeadEditModal
                open={!!editingLead}
                lead={editingLead}
                onClose={() => setEditingLead(null)}
                onSaved={reloadLeads}
                users={users}
                onAssign={assignLead}
            />

            <LeadQuickActionsModal
                lead={quickLead}
                onClose={() => setQuickLead(null)}
                onEdit={(lead) => {
                    setQuickLead(null);
                    setEditingLead(lead);
                }}
                onDelete={handleDeleteLead}
            />

            <AssignUserModal
                open={!!assigningLead}
                onClose={() => setAssigningLead(null)}
                users={users}
                onAssign={(userId) => assigningLead && handleAssignLead(assigningLead, userId)}
                saving={!!savingId}
            />
        </div>
    );
}

function MobileLeadQueue({
    leads,
    stats,
    filters,
    cityOptions,
    loading,
    loadingMore,
    hasMore,
    savingId,
    activeFiltersCount,
    onPatchFilters,
    onResetFilters,
    onReloadUsers,
    onLoadMore,
    onOpenCoverage,
    onOpenEdit,
    onDelete,
    onOpenAssign,
    viewMode,
    onChangeViewMode,
}: {
    leads: MetaLeadDoc[];
    stats: ReturnType<typeof useAdminLeadQueue>["stats"];
    filters: LeadFilters;
    cityOptions: { value: string; label: string }[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    savingId: string | null;
    activeFiltersCount: number;
    onPatchFilters: (patch: Partial<LeadFilters>) => void;
    onResetFilters: () => void;
    onReloadUsers: () => void;
    onLoadMore: () => void;
    onOpenCoverage: () => void;
    onOpenEdit: (lead: MetaLeadDoc) => void;
    onDelete: (lead: MetaLeadDoc) => void;
    onOpenAssign: (lead: MetaLeadDoc) => void;
    viewMode: "day" | "week";
    onChangeViewMode: (mode: "day" | "week") => void;
}) {
    const [filterModalOpen, setFilterModalOpen] = useState(false);

    const modalFiltersCount = useMemo(
        () =>
            (filters.city !== "all" ? 1 : 0) +
            (filters.assignment !== "all" ? 1 : 0) +
            (filters.startKey ? 1 : 0) +
            (filters.endKey ? 1 : 0),
        [filters.city, filters.assignment, filters.startKey, filters.endKey]
    );

    return (
        <div className="-mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] max-w-[100vw] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)] pb-6 text-[#101936]">

            {/* STICKY HEADER: title + stats + search */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-3 backdrop-blur-md">

                {/* TITLE ROW */}
                <div className="mb-3 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                            Leads Meta
                        </h1>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                            <span className="font-black text-[#7C3AED]">{leads.length}</span> visibles
                            {" · "}total <span className="font-black text-[#101936]">{stats.total}</span>
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => onChangeViewMode(viewMode === "day" ? "week" : "day")}
                        className="flex h-10 items-center rounded-[13px] border border-[#E8E7FB] bg-white px-3 text-[12px] font-black text-[#101936] shadow-sm transition active:bg-[#f3f0ff]"
                    >
                        {viewMode === "day" ? "Día" : "Semana"}
                    </button>
                    <MobileHeaderButton
                        onClick={onOpenCoverage}
                        disabled={loading || !leads.length}
                        icon="link"
                        label="Cobertura"
                    />
                    <Link
                        href="/admin/leads/assignments"
                        title="Asignaciones"
                        aria-label="Asignaciones"
                        className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                    >
                        <AppIcon
                            name="assign"
                            tone="purple"
                            size="sm"
                            className="h-[18px] w-[18px] bg-transparent text-[#7C3AED] ring-0"
                        />
                    </Link>
                </div>

                {/* STAT CARDS */}
                <div className="mb-3 grid grid-cols-4 gap-2">
                    <LeadStatCard
                        label="Revisar"
                        value={stats.pendingReview}
                        icon="search"
                        color="text-blue-500"
                        active={filters.status === "pending_review"}
                        onClick={() => onPatchFilters({ status: filters.status === "pending_review" ? "all" : "pending_review" })}
                    />
                    <LeadStatCard
                        label="Incompl."
                        value={stats.incomplete}
                        icon="clock"
                        color="text-amber-500"
                        active={filters.status === "incomplete"}
                        onClick={() => onPatchFilters({ status: filters.status === "incomplete" ? "all" : "incomplete" })}
                    />
                    <LeadStatCard
                        label="No aptos"
                        value={stats.notSuitable}
                        icon="ban"
                        color="text-red-500"
                        active={filters.status === "not_suitable"}
                        onClick={() => onPatchFilters({ status: filters.status === "not_suitable" ? "all" : "not_suitable" })}
                    />
                    <LeadStatCard
                        label="Todos"
                        value={stats.total}
                        icon="filter"
                        color="text-violet-500"
                        active={filters.status === "all"}
                        onClick={() => onPatchFilters({ status: "all" })}
                    />
                </div>

                {/* SEARCH + FILTER BUTTON */}
                <div className="flex gap-2">
                    <div className="flex h-[46px] flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 shadow-[0_2px_12px_rgba(91,33,255,0.07)]">
                        <AppIcon
                            name="search"
                            tone="purple"
                            size="sm"
                            className="h-5 w-5 shrink-0 bg-transparent text-[#98A2B3] ring-0"
                        />
                        <input
                            value={filters.search}
                            onChange={(e) => onPatchFilters({ search: e.target.value })}
                            placeholder="Buscar lead, teléfono, negocio..."
                            className="min-w-0 flex-1 bg-transparent font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            style={{ fontSize: "16px" }}
                        />
                        {filters.search ? (
                            <button
                                type="button"
                                onClick={() => onPatchFilters({ search: "" })}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f0ff] text-[16px] text-[#7C3AED] transition active:bg-violet-200"
                            >
                                ×
                            </button>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={() => setFilterModalOpen(true)}
                        className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border border-[#E8E7FB] bg-white shadow-[0_2px_12px_rgba(91,33,255,0.07)] transition active:bg-[#f3f0ff]"
                        aria-label="Filtros"
                    >
                        <AppIcon
                            name="filter"
                            tone="purple"
                            size="sm"
                            className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0"
                        />
                        {modalFiltersCount > 0 ? (
                            <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#7C3AED] text-[9px] font-black text-white">
                                {modalFiltersCount}
                            </span>
                        ) : null}
                    </button>
                </div>
            </div>

            {/* LEAD LIST */}
            <div className="grid min-w-0 gap-2 overflow-x-hidden px-3 pt-3">
                {loading ? (
                    <MobileState
                        icon="refresh"
                        title="Cargando leads"
                        body="Estamos preparando la cola operativa."
                    />
                ) : leads.length === 0 ? (
                    <MobileState
                        icon="filter"
                        title="Sin resultados"
                        body="No hay leads para ese filtro."
                    />
                ) : (
                    leads.map((lead) => (
                        <MobileLeadCard
                            key={lead.id}
                            lead={lead}
                            saving={savingId === lead.id}
                            onOpenEdit={onOpenEdit}
                            onDelete={onDelete}
                            onOpenAssign={onOpenAssign}
                        />
                    ))
                )}

                {hasMore ? (
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        className="mt-1 min-h-[46px] rounded-[14px] border border-[#E8E7FB] bg-white text-[12px] font-bold text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff] disabled:opacity-60"
                    >
                        {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                ) : null}
            </div>

            <MobileFiltersModal
                open={filterModalOpen}
                onClose={() => setFilterModalOpen(false)}
                filters={filters}
                cityOptions={cityOptions}
                onPatchFilters={onPatchFilters}
                onResetFilters={onResetFilters}
                activeFiltersCount={modalFiltersCount}
            />
        </div>
    );
}

function LeadStatCard({
    label,
    value,
    icon,
    color,
    active,
    onClick,
}: {
    label: string;
    value: number;
    icon: "search" | "clock" | "ban" | "filter";
    color: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                "relative min-w-0 rounded-[14px] border px-1.5 py-2.5 text-center transition active:opacity-80",
                active
                    ? "border-violet-200 bg-violet-50 shadow-[0_4px_16px_rgba(124,58,237,0.12)]"
                    : "border-[#E8E7FB] bg-white shadow-[0_4px_16px_rgba(91,33,255,0.06)]",
            ].join(" ")}
        >
            {active && (
                <span className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-gradient-to-r from-[#7c3aed] to-[#4f46e5]" />
            )}
            <div className="flex items-center justify-center gap-1">
                <AppIcon
                    name={icon}
                    tone="slate"
                    size="sm"
                    className={`h-4 w-4 bg-transparent ring-0 ${color}`}
                />
                <span className={[
                    "text-[13px] font-black",
                    active ? "text-violet-700" : "text-[#101936]",
                ].join(" ")}>
                    {value}
                </span>
            </div>
            <div className={[
                "mt-1 truncate text-[9px] font-semibold",
                active ? "text-violet-600" : "text-[#66739A]",
            ].join(" ")}>
                {label}
            </div>
        </button>
    );
}

function MobileLeadCard({
    lead,
    saving,
    onOpenEdit,
    onDelete,
    onOpenAssign,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onOpenEdit: (lead: MetaLeadDoc) => void;
    onDelete: (lead: MetaLeadDoc) => void;
    onOpenAssign: (lead: MetaLeadDoc) => void;
}) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const city = mobileCityName(lead);
    const hasCity = city !== "" && city !== "Sin ciudad";
    const hasBusiness = !!lead.business;

    return (
        <>
            <article className="min-w-0 max-w-full overflow-hidden rounded-[16px] border border-[#E8E7FB] bg-white p-3 shadow-[0_4px_18px_rgba(91,33,255,0.07)]">

                {/* TOP ROW: name/phone + "..." */}
                <div className="flex items-start justify-between gap-2">
                    <div className={saving ? "pointer-events-none min-w-0 flex-1 opacity-60" : "min-w-0 flex-1"}>
                        <div className="flex min-w-0 items-center gap-2">
                            <p className="min-w-0 flex-1 truncate text-[14px] font-black tracking-[-0.01em] text-[#101936]">
                                {lead.phone || displayName(lead)}
                            </p>
                            {hasNewInbound(lead) ? <Badge tone="green">Nuevo</Badge> : null}
                        </div>
                        {lead.name ? (
                            <p className="mt-0.5 truncate text-[12px] font-semibold text-[#344054]">
                                {lead.name}
                            </p>
                        ) : null}
                    </div>

                    <button
                        type="button"
                        onClick={() => setSheetOpen(true)}
                        disabled={saving}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] transition active:bg-[#f3f0ff] disabled:opacity-60"
                        aria-label="Acciones"
                    >
                        <AppIcon name="more" tone="slate" size="sm" className="h-4 w-4 bg-transparent text-[#98A2B3] ring-0" />
                    </button>
                </div>

                {/* ICON ROW: city · business */}
                <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">

                    {/* City */}
                    <div className="flex items-center gap-1">
                        <AppIcon
                            name="location"
                            tone="slate"
                            size="sm"
                            className={["h-[14px] w-[14px] bg-transparent ring-0", hasCity ? "text-emerald-500" : "text-red-400"].join(" ")}
                        />
                        {hasCity ? (
                            <span className="text-[11px] font-semibold text-[#344054]">{city}</span>
                        ) : null}
                    </div>

                    {/* Business */}
                    <div className="flex items-center gap-1">
                        <AppIcon
                            name="wallet"
                            tone="slate"
                            size="sm"
                            className={["h-[14px] w-[14px] bg-transparent ring-0", hasBusiness ? "text-emerald-500" : "text-red-400"].join(" ")}
                        />
                        {hasBusiness ? (
                            <span className="max-w-[90px] truncate text-[11px] font-semibold text-[#344054]">{lead.business}</span>
                        ) : null}
                    </div>
                </div>

                {/* META */}
                <p className="mt-2 truncate text-[10px] font-medium text-[#98A2B3]">
                    {formatDateShort(lead.createdAt)}
                    {" · "}
                    {formatDateShort(lead.lastInboundMessageAt || lead.updatedAt || lead.createdAt)}
                </p>

                {saving ? (
                    <p className="mt-1.5 text-[11px] font-medium text-[#98A2B3]">Procesando…</p>
                ) : null}
            </article>

            <LeadActionSheet
                lead={lead}
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                onOpenEdit={onOpenEdit}
                onDelete={onDelete}
                onOpenAssign={onOpenAssign}
            />
        </>
    );
}

function LeadActionSheet({
    lead,
    open,
    onClose,
    onOpenEdit,
    onDelete,
    onOpenAssign,
}: {
    lead: MetaLeadDoc;
    open: boolean;
    onClose: () => void;
    onOpenEdit: (lead: MetaLeadDoc) => void;
    onDelete: (lead: MetaLeadDoc) => void;
    onOpenAssign: (lead: MetaLeadDoc) => void;
}) {
    useEffect(() => {
        if (!open) return;
        const handler = () => onClose();
        window.addEventListener("scroll", handler, { passive: true });
        return () => window.removeEventListener("scroll", handler);
    }, [open, onClose]);

    if (!open) return null;

    const hasMaps = !!lead.location.mapsUrl;
    const waUrl = whatsappUrl(lead.phone);

    return (
        <>
            <button
                type="button"
                onClick={onClose}
                className="fixed inset-0 z-40 bg-black/40 xl:hidden"
                aria-label="Cerrar"
            />
            <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] xl:hidden">
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#E8E7FB]" />

                <div className="mb-4 min-w-0">
                    <p className="truncate text-[15px] font-black text-[#101936]">{displayName(lead)}</p>
                    {lead.business || lead.location.address ? (
                        <p className="mt-0.5 truncate text-[12px] font-semibold text-[#66739A]">
                            {lead.business || lead.location.address}
                        </p>
                    ) : null}
                </div>

                <div className="grid gap-2">
                    <Link
                        href={`/admin/leads/${lead.id}`}
                        onClick={onClose}
                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                    >
                        <AppIcon name="chat" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                        Chat
                    </Link>

                    <button
                        type="button"
                        onClick={() => { onClose(); onOpenEdit(lead); }}
                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#fff7ed] px-4 text-[14px] font-bold text-[#101936] transition active:bg-orange-100"
                    >
                        <AppIcon name="edit" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-orange-600 ring-0" />
                        Editar
                    </button>

                    <button
                        type="button"
                        onClick={() => { onClose(); onOpenAssign(lead); }}
                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                    >
                        <AppIcon name="assign" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                        Asignar a usuario
                    </button>

                    {hasMaps ? (
                        <a
                            href={lead.location.mapsUrl!}
                            target="_blank"
                            rel="noreferrer"
                            onClick={onClose}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-emerald-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-emerald-100"
                        >
                            <AppIcon name="map" tone="slate" size="sm" className="h-5 w-5 bg-transparent text-emerald-600 ring-0" />
                            Maps
                        </a>
                    ) : null}

                    {waUrl ? (
                        <a
                            href={waUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={onClose}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-emerald-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-emerald-100"
                        >
                            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-emerald-600 stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92Z" />
                            </svg>
                            WhatsApp
                        </a>
                    ) : null}

                    <button
                        type="button"
                        onClick={() => { onClose(); onDelete(lead); }}
                        className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-red-50 px-4 text-[14px] font-bold text-[#101936] transition active:bg-red-100"
                    >
                        <AppIcon name="trash" tone="red" size="sm" className="h-5 w-5 bg-transparent ring-0" />
                        Eliminar lead
                    </button>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 min-h-[48px] w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] text-[14px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                >
                    Cancelar
                </button>
            </div>
        </>
    );
}


function MobileFiltersModal({
    open,
    onClose,
    filters,
    cityOptions,
    onPatchFilters,
    onResetFilters,
    activeFiltersCount,
}: {
    open: boolean;
    onClose: () => void;
    filters: LeadFilters;
    cityOptions: { value: string; label: string }[];
    onPatchFilters: (patch: Partial<LeadFilters>) => void;
    onResetFilters: () => void;
    activeFiltersCount: number;
}) {
    if (!open) return null;

    return (
        <>
            <button
                type="button"
                onClick={onClose}
                className="fixed inset-0 z-40 bg-black/40 xl:hidden"
                aria-label="Cerrar filtros"
            />
            <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.15)] xl:hidden">
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#E8E7FB]" />

                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[15px] font-black text-[#101936]">Filtros</h3>
                    {activeFiltersCount > 0 ? (
                        <button
                            type="button"
                            onClick={onResetFilters}
                            className="text-[12px] font-bold text-[#7C3AED] transition active:opacity-70"
                        >
                            Limpiar todo
                        </button>
                    ) : null}
                </div>

                <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-2">
                        <label className="grid gap-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66739A]">Desde</span>
                            <input
                                type="date"
                                value={filters.startKey}
                                onChange={(e) => onPatchFilters({ startKey: e.target.value })}
                                className="h-10 rounded-[13px] border border-[#E8E7FB] bg-white px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66739A]">Hasta</span>
                            <input
                                type="date"
                                value={filters.endKey}
                                onChange={(e) => onPatchFilters({ endKey: e.target.value })}
                                className="h-10 rounded-[13px] border border-[#E8E7FB] bg-white px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                            />
                        </label>
                    </div>

                    <MobileFilterSelect
                        label="Ciudad"
                        value={filters.city}
                        onChange={(value) => onPatchFilters({ city: value })}
                    >
                        <option value="all">Todas las ciudades</option>
                        {cityOptions.map((city) => (
                            <option key={city.value} value={city.value}>
                                {city.label}
                            </option>
                        ))}
                    </MobileFilterSelect>

                    <MobileFilterSelect
                        label="Asignación"
                        value={filters.assignment}
                        onChange={(value) =>
                            onPatchFilters({
                                assignment: value as LeadFilters["assignment"],
                            })
                        }
                    >
                        <option value="all">Manual y auto</option>
                        <option value="auto">Auto-asignados</option>
                        <option value="manual">Manuales</option>
                    </MobileFilterSelect>
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    className="mt-4 min-h-[52px] w-full rounded-[14px] bg-[#7C3AED] text-[14px] font-bold text-white transition active:bg-violet-700"
                >
                    Listo
                </button>
            </div>
        </>
    );
}

function MobileHeaderButton({
    icon,
    label,
    onClick,
    disabled,
}: {
    icon: "assign" | "users" | "link";
    label: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff] disabled:opacity-50"
        >
            <AppIcon
                name={icon}
                tone="purple"
                size="sm"
                className="h-[18px] w-[18px] bg-transparent text-[#7C3AED] ring-0"
            />
        </button>
    );
}

function MobileFilterSelect({
    label,
    value,
    onChange,
    children,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: React.ReactNode;
}) {
    return (
        <label className="grid gap-1">
            <span className="text-[10px] font-bold text-[#98A2B3]">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-10 rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7c3aed]"
                style={{ fontSize: "16px" }}
            >
                {children}
            </select>
        </label>
    );
}

function MobileState({
    icon,
    title,
    body,
}: {
    icon: "filter" | "refresh";
    title: string;
    body: string;
}) {
    return (
        <div className="mt-10 flex flex-col items-center gap-3 px-4 text-center">
            {icon === "refresh" ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                    <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                    </svg>
                </div>
            ) : (
                <AppIcon name="filter" tone="slate" size="lg" />
            )}
            <p className="text-[13px] font-semibold text-[#66739A]">{title}</p>
            <p className="text-[11px] font-medium text-[#98A2B3]">{body}</p>
        </div>
    );
}

function FilterSelect({
    label,
    value,
    onChange,
    children,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: React.ReactNode;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#71717a]">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={selectClassName("w-full")}
            >
                {children}
            </select>
        </label>
    );
}

function FilterDate({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#71717a]">{label}</span>
            <input
                type="date"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={selectClassName("w-full")}
            />
        </label>
    );
}

function LeadsTable({
    leads,
    loading,
    savingId,
    onQuickActions,
}: {
    leads: MetaLeadDoc[];
    loading: boolean;
    savingId: string | null;
    onQuickActions: (lead: MetaLeadDoc) => void;
}) {
    return (
        <div className="border-t border-[#f0f1f2]">
            <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[960px] border-collapse">
                    <thead>
                        <tr className="border-b border-[#f0f1f2] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                            <th className="px-3 py-2.5">Lead</th>
                            <th className="px-3 py-2.5">Estado</th>
                            <th className="px-3 py-2.5">Ciudad</th>
                            <th className="px-3 py-2.5">Último mensaje</th>
                            <th className="px-3 py-2.5 text-right">Actividad</th>
                        </tr>
                    </thead>

                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={5}>
                                    <TableState
                                        icon="refresh"
                                        title="Cargando leads"
                                        body="Estamos preparando la cola operativa."
                                    />
                                </td>
                            </tr>
                        ) : leads.length === 0 ? (
                            <tr>
                                <td colSpan={5}>
                                    <TableState
                                        icon="filter"
                                        title="Sin resultados"
                                        body="No hay leads con esos filtros."
                                    />
                                </td>
                            </tr>
                        ) : (
                            leads.map((lead) => (
                                <LeadRow
                                    key={lead.id}
                                    lead={lead}
                                    saving={savingId === lead.id}
                                    onQuickActions={onQuickActions}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function LeadRow({
    lead,
    saving,
    onQuickActions,
}: {
    lead: MetaLeadDoc;
    saving: boolean;
    onQuickActions: (lead: MetaLeadDoc) => void;
}) {
    return (
        <tr
            onClick={() => {
                if (!saving) onQuickActions(lead);
            }}
            className="cursor-pointer border-b border-[#f0f1f2] last:border-0 hover:bg-[#f8f7ff]"
        >
            <td className="px-3 py-2.5">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-semibold text-[#171717]">
                            {displayName(lead)}
                        </span>
                        {hasNewInbound(lead) ? <Badge tone="green">NEW</Badge> : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium text-[#9ca3af]">
                        <span>{lead.phone || "Sin teléfono"}</span>
                        {lead.business ? <span>{lead.business}</span> : null}
                    </div>
                </div>
            </td>

            <td className="px-3 py-2.5">
                <Badge tone={statusTone[lead.verificationStatus]}>
                    {statusLabel[lead.verificationStatus]}
                </Badge>
                <div className="mt-1 max-w-[210px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {quickStatus(lead)}
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <span className="max-w-[190px] truncate text-[12px] font-semibold text-[#171717]">
                        {cityLabel(lead)}
                    </span>
                    {lead.location.outOfCoverage ? <Badge tone="yellow">Fuera</Badge> : null}
                </div>
                <div className="mt-0.5 max-w-[220px] truncate text-[11px] font-medium text-[#9ca3af]">
                    {lead.location.address || "Dirección no informada"}
                </div>
            </td>

            <td className="px-3 py-2.5">
                <div className="max-w-[250px] truncate text-[12px] font-medium text-[#52525b]">
                    {lead.lastInboundText || "Sin mensaje reciente"}
                </div>
            </td>

            <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-[#71717a]">
                {formatDate(lead.lastInboundMessageAt || lead.updatedAt || lead.createdAt)}
            </td>
        </tr>
    );
}

function TableState({
    icon,
    title,
    body,
}: {
    icon: "filter" | "refresh";
    title: string;
    body: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <AppIcon
                name={icon}
                tone={icon === "refresh" ? "purple" : "slate"}
                size="lg"
            />
            <div className="mt-3 text-[13px] font-bold text-[#101936]">{title}</div>
            <div className="mt-1 text-[12px] font-medium text-[#66739a]">{body}</div>
        </div>
    );
}

function LeadQuickActionsModal({
    lead,
    onClose,
    onEdit,
    onDelete,
}: {
    lead: MetaLeadDoc | null;
    onClose: () => void;
    onEdit: (lead: MetaLeadDoc) => void;
    onDelete: (lead: MetaLeadDoc) => void;
}) {
    if (!lead) return null;

    return (
        <Modal
            open={!!lead}
            onClose={onClose}
            title={displayName(lead)}
            subtitle={lead.business || lead.location.address || lead.phone || "Acciones rápidas"}
            size="sm"
        >
            <div className="grid gap-2">
                <ActionTile
                    href={`/admin/leads/${lead.id}`}
                    icon="chat"
                    label="Chat"
                    tone="purple"
                />
                {lead.location.mapsUrl ? (
                    <ActionTile
                        href={lead.location.mapsUrl}
                        icon="map"
                        label="Maps"
                        tone="green"
                        external
                    />
                ) : null}
                {whatsappUrl(lead.phone) ? (
                    <ActionTile
                        href={whatsappUrl(lead.phone)}
                        icon="chat"
                        label="WhatsApp"
                        tone="green"
                        external
                    />
                ) : null}
                <ActionTileButton
                    onClick={() => onEdit(lead)}
                    icon="edit"
                    label="Editar"
                    tone="orange"
                />
                <ActionTileButton
                    onClick={() => onDelete(lead)}
                    icon="trash"
                    label="Eliminar lead"
                    tone="red"
                />
            </div>
        </Modal>
    );
}

function CoverageAssignModal({
    open,
    onClose,
    leads,
    users,
    savingId,
    onAssign,
}: {
    open: boolean;
    onClose: () => void;
    leads: MetaLeadDoc[];
    users: UserDoc[];
    savingId: string | null;
    onAssign: (lead: MetaLeadDoc, userId: string) => Promise<void>;
}) {
    const [query, setQuery] = useState("");
    const [running, setRunning] = useState(false);

    const eligibleLeads = useMemo(
        () => leads.filter((l) => l.verificationStatus !== "not_suitable"),
        [leads]
    );

    const matches = useMemo(() => {
        const q = query.toLowerCase().trim();
        const base = buildCoverageMatches(eligibleLeads, users);

        if (!q) return base;

        return base
            .map((match) => {
                const userHaystack = [
                    match.user.name,
                    match.user.email,
                    userCoverageLabel(match.user),
                ]
                    .join(" ")
                    .toLowerCase();

                const filteredLeads = match.leads.filter((lead) =>
                    [
                        displayName(lead),
                        lead.phone,
                        lead.business,
                        cityLabel(lead),
                        lead.location.address,
                    ]
                        .join(" ")
                        .toLowerCase()
                        .includes(q)
                );

                return {
                    ...match,
                    leads: userHaystack.includes(q) ? match.leads : filteredLeads,
                };
            })
            .filter((match) => match.leads.length > 0);
    }, [eligibleLeads, query, users]);

    const plan = useMemo(() => {
        const used = new Set<string>();
        const rows: Array<{ lead: MetaLeadDoc; user: UserDoc }> = [];

        for (const match of matches) {
            for (const lead of match.leads) {
                if (used.has(lead.id)) continue;
                used.add(lead.id);
                rows.push({ lead, user: match.user });
            }
        }

        return rows;
    }, [matches]);

    async function assignAll() {
        if (!plan.length) return;
        const ok = window.confirm(`Asignar ${plan.length} lead(s) por cobertura?`);
        if (!ok) return;

        setRunning(true);
        try {
            for (const item of plan) {
                await onAssign(item.lead, item.user.id);
            }
            onClose();
        } finally {
            setRunning(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Asignar por cobertura"
            subtitle={`${plan.length} sugerencias · ${eligibleLeads.length} leads aptos`}
        >
            <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar usuario, ciudad o lead..."
                    />
                    <Button
                        variant="primary"
                        onClick={assignAll}
                        disabled={running || !plan.length}
                    >
                        {running ? "Asignando..." : "Asignar visibles"}
                    </Button>
                </div>

                <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
                    {!matches.length ? (
                        <div className="rounded-lg border border-[#e5e7eb] bg-[#fafafa] p-5 text-center text-[13px] font-medium text-[#71717a]">
                            No hay coincidencias de cobertura en los leads cargados.
                        </div>
                    ) : (
                        matches.map((match) => (
                            <div
                                key={match.user.id}
                                className="rounded-lg border border-[#e5e7eb] bg-white"
                            >
                                <div className="flex items-center justify-between gap-3 border-b border-[#f0f1f2] px-3 py-3">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <AppIcon name="user" tone="blue" size="sm" className="h-7 w-7 shrink-0" />
                                        <div className="min-w-0">
                                            <div className="truncate text-[12px] font-semibold text-[#171717]">
                                                {match.user.name ||
                                                    match.user.email ||
                                                    match.user.id}
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                                {userCoverageLabel(match.user)}
                                            </div>
                                        </div>
                                    </div>
                                    <Badge tone="blue">{match.leads.length}</Badge>
                                </div>

                                <div className="divide-y divide-[#f0f1f2]">
                                    {match.leads.slice(0, 8).map((lead) => (
                                        <div
                                            key={`${match.user.id}-${lead.id}`}
                                            className="grid gap-3 px-3 py-3 sm:grid-cols-[1fr_auto]"
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate text-[12px] font-semibold text-[#171717]">
                                                    {displayName(lead)}
                                                </div>
                                                <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                                    {cityLabel(lead)} -{" "}
                                                    {lead.business || lead.phone}
                                                </div>
                                            </div>
                                            <Button
                                                onClick={() => onAssign(lead, match.user.id)}
                                                disabled={running || savingId === lead.id}
                                            >
                                                Asignar
                                            </Button>
                                        </div>
                                    ))}

                                    {match.leads.length > 8 ? (
                                        <div className="px-3 py-2 text-[11px] font-medium text-[#9ca3af]">
                                            +{match.leads.length - 8} más
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </Modal>
    );
}
