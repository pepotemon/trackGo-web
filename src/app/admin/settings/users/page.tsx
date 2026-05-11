"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCan } from "@/features/auth/usePermissions";
import { useAuth } from "@/features/auth/AuthProvider";
import {
    createManagedUserProfile,
    listAdminUsers,
    updateUserAutoAssign,
    updateUserBilling,
    updateUserGeoCoverage,
    updateManagedUserCredentials,
    updateUserPermissions,
    updateUserPhoneCodes,
    updateUserProfile,
    updateUserRole,
    updateUserSharedWith,
    updateUserVendorPermissions,
} from "@/data/usersRepo";
import { batchUpdateWeekEventRates, countWeekVisitedEvents } from "@/data/accountingRepo";
import { weekRangeKeysMonToSun } from "@/lib/date";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import {
    defaultAdminPermissions,
    defaultUserPermissions,
    fullAdminPermissions,
    fullUserPermissions,
    type AdminPermissions,
    type UserBillingMode,
    type UserDoc,
    type UserGeoCoverage,
    type UserGeoCoverageType,
    type UserPermissions,
    type UserRole,
    type UserSharedAdmin,
} from "@/types/users";
import {
    AppIcon,
    Badge,
    Button,
    Card,
    Field,
    IconButton,
    Input,
    KpiCard,
    Modal,
    PageHeader,
} from "@/components/ui";

type EditorTab = "profile" | "coverage" | "role" | "autoAssign" | "billing" | "permissions" | "shared";
type RoleFilter = "all" | "admin" | "user";
type AutoFilter = "all" | "on" | "off";
type BillingFilter = "all" | "per_visit" | "weekly_subscription";
type IconName =
    | "check"
    | "plus"
    | "refresh"
    | "power"
    | "x"
    | "trash"
    | "map"
    | "user"
    | "shield"
    | "bot"
    | "wallet"
    | "link"
    | "percent";

function money(n?: number | null) {
    return `R$ ${(Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2)}`;
}

function onlyNumberLike(text: string) {
    const t = String(text ?? "").replace(",", ".").trim();
    if (!t) return "";
    const cleaned = t.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length <= 2) return cleaned;
    return `${parts[0]}.${parts.slice(1).join("")}`;
}

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function norm(text: unknown) {
    return String(text ?? "").toLowerCase().trim();
}

function selectClassName(extra = "") {
    return [
        "h-10 w-full rounded-[15px] border border-white/[0.08] bg-[#0F172A] px-3 text-[13px] font-bold text-[#F9FAFB] outline-none transition focus:border-blue-400/35 focus:ring-2 focus:ring-blue-400/10 sm:h-9 sm:rounded-lg sm:text-[12px] xl:border-[#e4e7ec] xl:bg-white xl:font-semibold xl:text-[#344054] xl:focus:border-[#2563eb] xl:focus:ring-blue-100",
        extra,
    ].join(" ");
}

function normalizeCoverageText(value: unknown) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[\s\-/]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

const COUNTRY_PHONE_CODES: Record<string, string> = {
    panama: "507",
    guatemala: "502",
    el_salvador: "503",
    honduras: "504",
    nicaragua: "505",
    costa_rica: "506",
    republica_dominicana: "509",
    ecuador: "593",
    bolivia: "591",
    paraguay: "595",
    uruguay: "598",
};

function countryPhoneCode(countryLabel: string) {
    return COUNTRY_PHONE_CODES[normalizeCoverageText(countryLabel)] ?? null;
}

function coverageLabel(user: UserDoc) {
    const items = Array.isArray(user.geoCoverage) ? user.geoCoverage : [];
    if (!items.length) return "Sin cobertura";

    const active = items.filter((item) => item.active !== false);
    const visible = (active.length ? active : items)
        .slice(0, 2)
        .map(
            (item) =>
                item.displayLabel ||
                item.cityLabel ||
                item.stateLabel ||
                item.countryLabel
        )
        .filter(Boolean);

    if (!visible.length) return "Sin cobertura";
    return items.length > 2
        ? `${visible.join(" - ")} +${items.length - 2}`
        : visible.join(" - ");
}

function buildCoverageItem(input: {
    type: UserGeoCoverageType;
    countryLabel: string;
    stateLabel: string;
    cityLabel: string;
}): UserGeoCoverage | null {
    const type = input.type;
    const countryLabel = input.countryLabel.trim() || "Brasil";
    const stateLabel = input.stateLabel.trim();
    const cityLabel = input.cityLabel.trim();
    const countryNormalized = normalizeCoverageText(countryLabel);
    const stateNormalized = normalizeCoverageText(stateLabel);
    const cityNormalized = normalizeCoverageText(cityLabel);

    if (type === "country" && !countryNormalized) return null;
    if (type === "state" && !stateNormalized) return null;
    if (type === "city" && (!stateNormalized || !cityNormalized)) return null;

    const displayLabel =
        type === "country"
            ? countryLabel
            : type === "state"
                ? `${stateLabel}, ${countryLabel}`
                : `${cityLabel}, ${stateLabel}`;

    const now = Date.now();

    return {
        id: [
            type,
            countryNormalized || "all",
            stateNormalized || "all",
            cityNormalized || "all",
        ].join("__"),
        type,
        countryLabel,
        countryNormalized,
        stateLabel,
        stateNormalized,
        cityLabel,
        cityNormalized,
        displayLabel,
        source: "manual",
        active: true,
        createdAt: now,
        updatedAt: now,
    };
}

function Icon({ name }: { name: IconName }) {
    const common = {
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        strokeWidth: 2,
    };

    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
            {name === "check" ? <path {...common} d="M20 6 9 17l-5-5" /> : null}
            {name === "plus" ? <path {...common} d="M12 5v14M5 12h14" /> : null}
            {name === "refresh" ? (
                <>
                    <path {...common} d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                    <path {...common} d="M3 21v-5h5" />
                    <path {...common} d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                    <path {...common} d="M21 3v5h-5" />
                </>
            ) : null}
            {name === "power" ? (
                <>
                    <path {...common} d="M12 2v10" />
                    <path {...common} d="M18.4 6.6a9 9 0 1 1-12.8 0" />
                </>
            ) : null}
            {name === "x" ? <path {...common} d="M18 6 6 18M6 6l12 12" /> : null}
            {name === "trash" ? (
                <>
                    <path {...common} d="M3 6h18" />
                    <path {...common} d="M8 6V4h8v2" />
                    <path {...common} d="M19 6 18 20H6L5 6" />
                    <path {...common} d="M10 11v5M14 11v5" />
                </>
            ) : null}
            {name === "map" ? (
                <>
                    <path {...common} d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
                    <path {...common} d="M9 3v15M15 6v15" />
                </>
            ) : null}
            {name === "user" ? (
                <>
                    <path {...common} d="M20 21a8 8 0 0 0-16 0" />
                    <path {...common} d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                </>
            ) : null}
            {name === "shield" ? (
                <path {...common} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            ) : null}
            {name === "bot" ? (
                <>
                    <path {...common} d="M12 8V4" />
                    <path {...common} d="M8 4h8" />
                    <rect {...common} x="4" y="8" width="16" height="12" rx="3" />
                    <path {...common} d="M9 13h.01M15 13h.01M9 17h6" />
                </>
            ) : null}
            {name === "wallet" ? (
                <>
                    <path {...common} d="M3 7h15a3 3 0 0 1 3 3v8H5a2 2 0 0 1-2-2V7Z" />
                    <path {...common} d="M3 7V6a2 2 0 0 1 2-2h12v3" />
                    <path {...common} d="M17 13h.01" />
                </>
            ) : null}
            {name === "link" ? (
                <>
                    <path {...common} d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path {...common} d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </>
            ) : null}
            {name === "percent" ? (
                <>
                    <line {...common} x1="19" y1="5" x2="5" y2="19" />
                    <circle {...common} cx="6.5" cy="6.5" r="2.5" />
                    <circle {...common} cx="17.5" cy="17.5" r="2.5" />
                </>
            ) : null}
        </svg>
    );
}

export default function UsersPage() {
    const canUsersView = useCan("usersView");
    const canCreate = useCan("usersCreate");
    const canEdit = useCan("usersEdit");
    const { profile, isSuperAdmin } = useAuth();
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

    const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
    const [autoFilter, setAutoFilter] = useState<AutoFilter>("all");
    const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");

    const selectedUser = useMemo(
        () => users.find((u) => u.id === selectedUserId) ?? null,
        [users, selectedUserId]
    );

    const baseUsers = useMemo(() => {
        if (isSuperAdmin || !profile) return users;
        return users.filter(
            (u) => u.role === "admin" || u.sharedWith?.some((s) => s.adminId === profile.id)
        );
    }, [users, isSuperAdmin, profile]);

    const filteredUsers = useMemo(() => {
        const q = norm(search);

        return baseUsers.filter((u) => {
            if (roleFilter !== "all" && u.role !== roleFilter) return false;

            const autoEnabled = u.autoAssignEnabled === true;
            if (autoFilter === "on" && !autoEnabled) return false;
            if (autoFilter === "off" && autoEnabled) return false;

            if (billingFilter !== "all" && u.billingMode !== billingFilter) return false;

            if (!q) return true;

            const haystack = [
                u.id,
                u.name,
                u.email,
                u.role,
                u.active ? "activo active" : "inactivo inactive",
                u.billingMode === "weekly_subscription"
                    ? "suscripcion subscription semanal"
                    : "por visita per visit",
                u.whatsappPhone,
                coverageLabel(u),
                autoEnabled ? "auto asignacion on" : "auto asignacion off",
            ]
                .map(norm)
                .join(" ");

            return haystack.includes(q);
        });
    }, [baseUsers, search, roleFilter, autoFilter, billingFilter]);

    async function loadUsers() {
        setLoading(true);
        setErr(null);

        try {
            const data = await listAdminUsers();
            setUsers(data);
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : "No se pudieron cargar los usuarios.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        queueMicrotask(() => {
            void loadUsers();
        });
    }, []);

    const stats = useMemo(() => {
        return {
            total: baseUsers.length,
            active: baseUsers.filter((u) => u.active).length,
            admins: baseUsers.filter((u) => u.role === "admin").length,
            weekly: baseUsers.filter((u) => u.billingMode === "weekly_subscription").length,
        };
    }, [baseUsers]);

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (roleFilter !== "all") total++;
        if (autoFilter !== "all") total++;
        if (billingFilter !== "all") total++;
        if (search.trim()) total++;
        return total;
    }, [roleFilter, autoFilter, billingFilter, search]);

    async function patchUserLocal(userId: string, patch: Partial<UserDoc>) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...patch } : u)));
    }

    async function handleCreated(user: UserDoc) {
        setUsers((prev) => [user, ...prev.filter((u) => u.id !== user.id)]);
        setSelectedUserId(user.id);
        setCreateOpen(false);
    }

    function resetFilters() {
        setSearch("");
        setRoleFilter("all");
        setAutoFilter("all");
        setBillingFilter("all");
    }

    if (!canUsersView) return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fef2f2]">
                <svg viewBox="0 0 24 24" className="h-7 w-7 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            </div>
            <p className="text-[16px] font-black text-[#101936]">Sin permisos</p>
            <p className="max-w-xs text-[13px] font-semibold text-[#66739A]">No tienes acceso a esta pantalla. Contacta al superadmin.</p>
        </div>
    );

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <div className="xl:hidden">
                <MobileUsersView
                    users={filteredUsers}
                    stats={stats}
                    search={search}
                    loading={loading}
                    selectedUserId={selectedUserId}
                    roleFilter={roleFilter}
                    autoFilter={autoFilter}
                    billingFilter={billingFilter}
                    filtersOpen={mobileFiltersOpen}
                    activeFiltersCount={activeFiltersCount}
                    canCreate={canCreate}
                    onSearch={setSearch}
                    onSelectUser={canEdit ? setSelectedUserId : undefined}
                    onRefresh={loadUsers}
                    onCreate={() => setCreateOpen(true)}
                    onToggleFilters={() => setMobileFiltersOpen((value) => !value)}
                    onResetFilters={resetFilters}
                    onRoleFilter={(value) => setRoleFilter(value)}
                    onAutoFilter={(value) => setAutoFilter(value)}
                    onBillingFilter={(value) => setBillingFilter(value)}
                />
            </div>

            <div className="hidden xl:block">
                <PageHeader
                    title="Usuarios"
                    subtitle="Gestiona permisos, cobertura, auto-asignación y modelos de pago."
                    icon={
                        <AppIcon
                            name="users"
                            tone="blue"
                            size="sm"
                            className="bg-transparent text-white ring-0"
                        />
                    }
                    actions={
                        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
                            <IconButton
                                icon="refresh"
                                label="Actualizar"
                                variant="primary"
                                onClick={loadUsers}
                            />
                            {canCreate ? (
                                <IconButton
                                    icon="plus"
                                    label="Crear usuario"
                                    variant="primary"
                                    onClick={() => setCreateOpen(true)}
                                />
                            ) : null}
                        </div>
                    }
                />

                {err ? (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                        {err}
                    </div>
                ) : null}

                <section className="mb-4 grid grid-cols-4 gap-4">
                    <KpiCard label="Usuarios" value={stats.total} caption="Total registrado" icon="users" tone="blue" />
                    <KpiCard label="Activos" value={stats.active} caption="Usuarios operativos" icon="check" tone="green" />
                    <KpiCard label="Admins" value={stats.admins} caption="Permisos admin" icon="assign" tone="purple" />
                    <KpiCard label="Suscripción" value={stats.weekly} caption="Modelo semanal" icon="lead" tone="orange" />
                </section>

                <Card className="overflow-hidden">
                    <div className="flex flex-col gap-3 bg-gradient-to-b from-white to-[#fbfaff] px-4 py-4">
                        <div className="flex flex-row items-center justify-between gap-3">
                            <div>
                                <h2 className="text-[14px] font-semibold text-[#172033]">Equipo</h2>
                                <p className="mt-0.5 text-[12px] font-medium text-[#667085]">
                                    {filteredUsers.length} visibles de {users.length} usuarios
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar usuario..."
                                    className="w-[320px]"
                                />

                                {activeFiltersCount > 0 ? (
                                    <IconButton
                                        icon="close"
                                        label="Limpiar filtros"
                                        onClick={resetFilters}
                                    />
                                ) : null}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <FilterSelect
                                label="Rol"
                                value={roleFilter}
                                onChange={(value) => setRoleFilter(value as RoleFilter)}
                            >
                                <option value="all">Todos los roles</option>
                                <option value="admin">Admins</option>
                                <option value="user">Vendedores</option>
                            </FilterSelect>

                            <FilterSelect
                                label="Auto-asignación"
                                value={autoFilter}
                                onChange={(value) => setAutoFilter(value as AutoFilter)}
                            >
                                <option value="all">Todos</option>
                                <option value="on">Auto ON</option>
                                <option value="off">Auto OFF</option>
                            </FilterSelect>

                            <FilterSelect
                                label="Modelo de cobro"
                                value={billingFilter}
                                onChange={(value) => setBillingFilter(value as BillingFilter)}
                            >
                                <option value="all">Todos los modelos</option>
                                <option value="per_visit">Por visita</option>
                                <option value="weekly_subscription">Suscripción</option>
                            </FilterSelect>
                        </div>
                    </div>

                    <UsersTable
                        users={filteredUsers}
                        loading={loading}
                        selectedUserId={selectedUserId}
                        onSelectUser={canEdit ? setSelectedUserId : undefined}
                    />
                </Card>
            </div>

            {canEdit ? (
                <EditUserModal
                    user={selectedUser}
                    open={!!selectedUser}
                    savingId={savingId}
                    canManageCredentials={isSuperAdmin}
                    adminUsers={users.filter((u) => u.role === "admin" && !u.isSuperAdmin)}
                    onClose={() => setSelectedUserId(null)}
                    onSaving={setSavingId}
                    onPatch={patchUserLocal}
                    onError={setErr}
                />
            ) : null}

            <CreateUserModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={handleCreated}
                onError={setErr}
            />
        </div>
    );
}

function MobileUsersView({
    users,
    stats,
    search,
    loading,
    selectedUserId,
    roleFilter,
    autoFilter,
    billingFilter,
    filtersOpen,
    activeFiltersCount,
    canCreate,
    onSearch,
    onSelectUser,
    onRefresh,
    onCreate,
    onToggleFilters,
    onResetFilters,
    onRoleFilter,
    onAutoFilter,
    onBillingFilter,
}: {
    users: UserDoc[];
    stats: { total: number; active: number; admins: number; weekly: number };
    search: string;
    loading: boolean;
    selectedUserId: string | null;
    roleFilter: RoleFilter;
    autoFilter: AutoFilter;
    billingFilter: BillingFilter;
    filtersOpen: boolean;
    activeFiltersCount: number;
    canCreate: boolean;
    onSearch: (value: string) => void;
    onSelectUser?: (id: string) => void;
    onRefresh: () => void;
    onCreate: () => void;
    onToggleFilters: () => void;
    onResetFilters: () => void;
    onRoleFilter: (value: RoleFilter) => void;
    onAutoFilter: (value: AutoFilter) => void;
    onBillingFilter: (value: BillingFilter) => void;
}) {
    useBackButtonDismiss(filtersOpen, onToggleFilters);

    return (
        <div className="-mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] max-w-[100vw] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)] pb-6 text-[#101936]">

            {/* STICKY HEADER */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-3 backdrop-blur-md">

                {/* TITLE ROW */}
                <div className="mb-3 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">Usuarios</h1>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                            <span className="font-black text-[#7C3AED]">{stats.active}</span> activos ·{" "}
                            <span className="font-black text-[#101936]">{stats.total}</span> total
                        </p>
                    </div>
                    {canCreate ? (
                        <button
                            type="button"
                            onClick={onCreate}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Crear usuario"
                            title="Crear usuario"
                        >
                            <AppIcon name="plus" tone="purple" size="sm" className="h-[18px] w-[18px] bg-transparent text-[#7C3AED] ring-0" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff] disabled:opacity-50"
                        aria-label="Actualizar"
                        title="Actualizar"
                    >
                        <AppIcon name="refresh" tone="purple" size="sm" className="h-[18px] w-[18px] bg-transparent text-[#7C3AED] ring-0" />
                    </button>
                </div>

                {/* STAT CARDS */}
                <div className="mb-3 grid grid-cols-4 gap-2">
                    <MobileStat label="Total" value={stats.total} icon="users" tone="blue" />
                    <MobileStat label="Activos" value={stats.active} icon="check" tone="green" />
                    <MobileStat label="Admins" value={stats.admins} icon="assign" tone="purple" />
                    <MobileStat label="Subs." value={stats.weekly} icon="lead" tone="amber" />
                </div>

                {/* SEARCH + FILTER BUTTON */}
                <div className="flex gap-2">
                    <div className="flex h-[46px] flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 shadow-[0_2px_12px_rgba(91,33,255,0.07)]">
                        <AppIcon name="search" tone="purple" size="sm" className="h-5 w-5 shrink-0 bg-transparent text-[#98A2B3] ring-0" />
                        <input
                            value={search}
                            onChange={(event) => onSearch(event.target.value)}
                            placeholder="Buscar usuario..."
                            className="min-w-0 flex-1 bg-transparent font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            style={{ fontSize: "16px" }}
                        />
                        {search ? (
                            <button type="button" onClick={() => onSearch("")} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f0ff] text-[16px] text-[#7C3AED] transition active:bg-violet-200">
                                ×
                            </button>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={onToggleFilters}
                        className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border border-[#E8E7FB] bg-white shadow-[0_2px_12px_rgba(91,33,255,0.07)] transition active:bg-[#f3f0ff]"
                        aria-label="Filtros"
                    >
                        <AppIcon name="filter" tone="purple" size="sm" className="h-5 w-5 bg-transparent text-[#7C3AED] ring-0" />
                        {activeFiltersCount > 0 ? (
                            <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#7C3AED] text-[9px] font-black text-white">
                                {activeFiltersCount}
                            </span>
                        ) : null}
                    </button>
                </div>
            </div>

            {/* USER LIST */}
            <div className="px-3 pt-3">
                <div className="grid min-w-0 gap-2">
                    {loading ? (
                        <UsersTableState icon="refresh" title="Cargando usuarios" body="Estamos preparando el equipo." />
                    ) : users.length === 0 ? (
                        <UsersTableState icon="filter" title="Sin resultados" body="No hay usuarios con ese filtro." />
                    ) : (
                        users.map((user) => (
                            <UserMobileCard
                                key={user.id}
                                user={user}
                                selected={selectedUserId === user.id}
                                onSelect={onSelectUser ? () => onSelectUser(user.id) : undefined}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* FILTER BOTTOM SHEET */}
            {filtersOpen ? (
                <div className="fixed inset-0 z-50 flex items-end">
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onToggleFilters} />
                    <div className="relative w-full rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-2xl">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h3 className="text-[16px] font-black text-[#101936]">Filtros</h3>
                                {activeFiltersCount > 0 ? (
                                    <p className="mt-0.5 text-[11px] font-semibold text-[#7C3AED]">{activeFiltersCount} activos</p>
                                ) : null}
                            </div>
                            <button type="button" onClick={onToggleFilters} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f0ff] text-[20px] text-[#7C3AED] transition active:bg-violet-200">
                                ×
                            </button>
                        </div>

                        <div className="grid gap-3">
                            <MobileField label="Rol">
                                <select value={roleFilter} onChange={(e) => onRoleFilter(e.target.value as RoleFilter)} className="h-11 w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none">
                                    <option value="all">Todos los roles</option>
                                    <option value="admin">Admins</option>
                                    <option value="user">Vendedores</option>
                                </select>
                            </MobileField>
                            <MobileField label="Auto-asignación">
                                <select value={autoFilter} onChange={(e) => onAutoFilter(e.target.value as AutoFilter)} className="h-11 w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none">
                                    <option value="all">Todos</option>
                                    <option value="on">Auto ON</option>
                                    <option value="off">Auto OFF</option>
                                </select>
                            </MobileField>
                            <MobileField label="Modelo de cobro">
                                <select value={billingFilter} onChange={(e) => onBillingFilter(e.target.value as BillingFilter)} className="h-11 w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 text-[13px] font-semibold text-[#101936] outline-none">
                                    <option value="all">Todos los modelos</option>
                                    <option value="per_visit">Por visita</option>
                                    <option value="weekly_subscription">Suscripción</option>
                                </select>
                            </MobileField>
                        </div>

                        <div className="mt-4 flex gap-2">
                            {activeFiltersCount > 0 ? (
                                <button type="button" onClick={() => { onResetFilters(); onToggleFilters(); }} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A] transition active:bg-[#f3f0ff]">
                                    Limpiar
                                </button>
                            ) : null}
                            <button type="button" onClick={onToggleFilters} className="min-h-[46px] flex-1 rounded-[14px] bg-[#7C3AED] text-[13px] font-black text-white transition active:bg-violet-700">
                                Aplicar
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function MobileStat({
    label,
    value,
    icon,
    tone,
}: {
    label: string;
    value: number;
    icon: Parameters<typeof AppIcon>[0]["name"];
    tone: "blue" | "green" | "purple" | "amber";
}) {
    const colorClass =
        tone === "blue" ? "text-blue-500"
        : tone === "green" ? "text-emerald-500"
        : tone === "purple" ? "text-violet-500"
        : "text-amber-500";

    return (
        <div className="min-w-0 rounded-[13px] border border-[#E8E7FB] bg-white px-1.5 py-2 shadow-sm">
            <div className="flex items-center justify-center gap-1">
                <AppIcon name={icon} tone="slate" size="sm" className={`h-4 w-4 bg-transparent ring-0 ${colorClass}`} />
                <span className="text-[12px] font-black text-[#101936]">{value}</span>
            </div>
            <div className="mt-1 truncate text-center text-[9px] font-black text-[#66739A]">{label}</div>
        </div>
    );
}

function MobileField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid gap-1">
            <span className="text-[11px] font-semibold text-[#66739A]">{label}</span>
            {children}
        </label>
    );
}

function UsersTable({
    users,
    loading,
    selectedUserId,
    onSelectUser,
}: {
    users: UserDoc[];
    loading: boolean;
    selectedUserId: string | null;
    onSelectUser?: (id: string) => void;
}) {
    return (
        <div className="border-t border-[#eef1f5]">
            <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[920px] border-collapse">
                    <thead>
                        <tr className="border-b border-[#eef1f5] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                            <th className="px-3 py-2.5">Usuario</th>
                            <th className="px-3 py-2.5">Rol</th>
                            <th className="px-3 py-2.5">Estado</th>
                            <th className="px-3 py-2.5">Modelo</th>
                            <th className="px-3 py-2.5">Cobertura</th>
                            <th className="px-3 py-2.5">Auto</th>
                        </tr>
                    </thead>

                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6}>
                                    <UsersTableState
                                        icon="refresh"
                                        title="Cargando usuarios"
                                        body="Estamos preparando el equipo."
                                    />
                                </td>
                            </tr>
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan={6}>
                                    <UsersTableState
                                        icon="filter"
                                        title="Sin resultados"
                                        body="No hay usuarios con ese filtro."
                                    />
                                </td>
                            </tr>
                        ) : (
                            users.map((u) => {
                                const selected = selectedUserId === u.id;
                                const autoEnabled = u.autoAssignEnabled === true;

                                return (
                                    <tr
                                        key={u.id}
                                        onClick={onSelectUser ? () => onSelectUser(u.id) : undefined}
                                        className={
                                            selected
                                                ? "border-b border-[#eef1f5] bg-[#eff6ff] last:border-0" + (onSelectUser ? " cursor-pointer" : "")
                                                : "border-b border-[#eef1f5] last:border-0" + (onSelectUser ? " cursor-pointer hover:bg-[#f9fafb]" : "")
                                        }
                                    >
                                        <td className="px-3 py-2.5">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c3aed] to-[#2563eb] text-[12px] font-semibold text-white shadow-sm">
                                                    {(u.name || u.email || "U").slice(0, 1).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate text-[12px] font-semibold text-[#172033]">
                                                        {u.name || "Usuario"}
                                                    </div>
                                                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#98a2b3]">
                                                        {u.email || "Sin correo registrado"}
                                                    </div>
                                                    <SharedUserPill user={u} className="mt-1" />
                                                </div>
                                            </div>
                                        </td>

                                        <td className="px-3 py-2.5">
                                            <Badge tone={u.role === "admin" ? "blue" : "gray"}>
                                                {u.role === "admin" ? "Admin" : "Vendedor"}
                                            </Badge>
                                        </td>

                                        <td className="px-3 py-2.5">
                                            <Badge tone={u.active ? "green" : "red"}>
                                                {u.active ? "Activo" : "Inactivo"}
                                            </Badge>
                                        </td>

                                        <td className="px-3 py-2.5">
                                            <Badge tone="gray">
                                                {u.billingMode === "weekly_subscription"
                                                    ? "Suscripción"
                                                    : "Por visita"}
                                            </Badge>
                                        </td>

                                        <td className="px-3 py-2.5">
                                            <div className="max-w-[220px] truncate text-[12px] font-semibold text-[#344054]">
                                                {coverageLabel(u)}
                                            </div>
                                        </td>

                                        <td className="px-3 py-2.5">
                                            <Badge tone={autoEnabled ? "green" : "gray"}>
                                                {autoEnabled ? "Auto ON" : "Auto OFF"}
                                            </Badge>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function FilterSelect({
    label,
    value,
    children,
    onChange,
}: {
    label: string;
    value: string;
    children: ReactNode;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.07em] text-[#667085]">
                {label}
            </span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className={selectClassName()}
            >
                {children}
            </select>
        </label>
    );
}

function UsersTableState({
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
            {icon === "refresh" ? (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                    <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                    </svg>
                </div>
            ) : (
                <AppIcon name={icon} tone="slate" size="lg" />
            )}
            <div className="mt-3 text-[13px] font-bold text-[#101936]">
                {title}
            </div>
            <div className="mt-1 text-[12px] font-medium text-[#66739a]">
                {body}
            </div>
        </div>
    );
}

function UserMobileCard({
    user,
    selected,
    onSelect,
}: {
    user: UserDoc;
    selected: boolean;
    onSelect?: () => void;
}) {
    const autoEnabled = user.autoAssignEnabled === true;

    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={!onSelect}
            className={[
                "block w-full max-w-full overflow-hidden rounded-[16px] border text-left transition",
                selected
                    ? "border-violet-200 bg-violet-50"
                    : "border-[#E8E7FB] bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]" + (onSelect ? " active:bg-[#f3f0ff]" : ""),
            ].join(" ")}
        >
            <div className="p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-[#7c3aed] to-[#2563eb] text-[13px] font-black text-white shadow-sm">
                            {(user.name || user.email || "U").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <div className="truncate text-[13px] font-black text-[#101936]">{user.name || "Usuario"}</div>
                            <div className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">{user.email || "Sin correo registrado"}</div>
                        </div>
                    </div>
                    <Badge tone={user.active ? "green" : "red"}>
                        {user.active ? "Activo" : "Inactivo"}
                    </Badge>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={user.role === "admin" ? "blue" : "gray"}>
                        {user.role === "admin" ? "Admin" : "Vendedor"}
                    </Badge>
                    <Badge tone="gray">
                        {user.billingMode === "weekly_subscription" ? "Suscripción" : "Por visita"}
                    </Badge>
                    <Badge tone={autoEnabled ? "green" : "gray"}>
                        {autoEnabled ? "Auto ON" : "Auto OFF"}
                    </Badge>
                    <SharedUserPill user={user} />
                </div>

                <div className="mt-2.5 flex items-center gap-2 rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-2">
                    <AppIcon name="map" tone="purple" size="sm" className="h-4 w-4 bg-transparent text-[#7C3AED] ring-0" />
                    <div className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#66739A]">
                        {coverageLabel(user)}
                    </div>
                </div>
            </div>
        </button>
    );
}

function SharedUserPill({
    user,
    className = "",
}: {
    user: UserDoc;
    className?: string;
}) {
    const shared = user.role === "user" ? (user.sharedWith ?? []).filter((entry) => entry.adminId) : [];
    if (!shared.length) return null;

    const visibleDots = Math.min(shared.length, 3);
    const title = shared
        .map((entry) => `${entry.adminName || entry.adminId}: ${entry.percentage}%`)
        .join(" · ");

    return (
        <span
            title={title}
            className={[
                "inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.04em] text-[#6d28d9]",
                className,
            ].join(" ")}
        >
            <span>Compartida</span>
            <span className="flex -space-x-1">
                {Array.from({ length: visibleDots }).map((_, index) => (
                    <span
                        key={index}
                        className="flex h-4 w-4 items-center justify-center rounded-full border border-white bg-gradient-to-br from-[#a855f7] to-[#2563eb] text-[8px] text-white"
                    >
                        {index + 1}
                    </span>
                ))}
            </span>
            {shared.length > 3 ? <span>+{shared.length - 3}</span> : null}
        </span>
    );
}

function CreateUserModal({
    open,
    onClose,
    onCreated,
    onError,
}: {
    open: boolean;
    onClose: () => void;
    onCreated: (user: UserDoc) => void;
    onError: (msg: string | null) => void;
}) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [whatsappPhone, setWhatsappPhone] = useState("");
    const [role, setRole] = useState<UserRole>("user");
    const [saving, setSaving] = useState(false);

    async function create() {
        const cleanEmail = email.trim().toLowerCase();
        const cleanPassword = password.trim();

        if (!cleanEmail) {
            onError("El email es obligatorio.");
            return;
        }

        if (cleanPassword.length < 6) {
            onError("La contraseña debe tener mínimo 6 caracteres.");
            return;
        }

        setSaving(true);
        onError(null);

        try {
            const created = await createManagedUserProfile({
                name: name.trim() || "Usuario",
                email: cleanEmail,
                password: cleanPassword,
                whatsappPhone: whatsappPhone.trim(),
                role,
                billingMode: "per_visit",
                ratePerVisit: 0,
                weeklySubscriptionAmount: 0,
                weeklySubscriptionCost: 0,
                weeklySubscriptionActive: true,
                autoAssignEnabled: false,
                autoAssignDailyLimit: null,
                geoCoverage: [],
            });

            onCreated(created);

            setName("");
            setEmail("");
            setPassword("");
            setWhatsappPhone("");
            setRole("user");
        } catch (e: unknown) {
            onError(e instanceof Error ? e.message : "No se pudo crear el usuario.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Crear usuario"
            subtitle="Crea el acceso real en Firebase Auth y su perfil operativo."
        >
            <div className="space-y-4">
                <EditorBlock title="Datos de acceso">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Nombre">
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </Field>

                        <Field label="Email">
                            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                        </Field>
                    </div>

                    <Field label="Contraseña temporal">
                        <Input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mínimo 6 caracteres"
                        />
                    </Field>

                    <Field label="WhatsApp operativo">
                        <Input
                            value={whatsappPhone}
                            onChange={(e) => setWhatsappPhone(e.target.value)}
                            placeholder="+55..."
                        />
                    </Field>
                </EditorBlock>

                <EditorBlock title="Rol inicial">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Choice active={role === "user"} onClick={() => setRole("user")} label="Vendedor" />
                        <Choice active={role === "admin"} onClick={() => setRole("admin")} label="Admin" />
                    </div>

                    <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-[12px] font-semibold text-[#6d5fb4]">
                        Se crea activo. Cobertura, auto-asignación y contabilidad se ajustan luego en editar.
                    </div>
                </EditorBlock>

                <div className="flex flex-col-reverse gap-2 border-t border-[#f0f1f2] pt-4 sm:flex-row sm:justify-end">
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button variant="primary" onClick={create} disabled={saving}>
                        {saving ? "Creando..." : "Crear usuario"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function EditUserModal({
    user,
    open,
    savingId,
    canManageCredentials,
    adminUsers,
    onClose,
    onSaving,
    onPatch,
    onError,
}: {
    user: UserDoc | null;
    open: boolean;
    savingId: string | null;
    canManageCredentials: boolean;
    adminUsers: UserDoc[];
    onClose: () => void;
    onSaving: (id: string | null) => void;
    onPatch: (userId: string, patch: Partial<UserDoc>) => Promise<void>;
    onError: (msg: string | null) => void;
}) {
    const [activeTab, setActiveTab] = useState<EditorTab>("profile");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [whatsappPhone, setWhatsappPhone] = useState("");
    const [role, setRole] = useState<UserRole>("user");
    const [active, setActive] = useState(true);
    const [billingMode, setBillingMode] = useState<UserBillingMode>("per_visit");
    const [ratePerVisit, setRatePerVisit] = useState("0");
    const [weeklyAmount, setWeeklyAmount] = useState("0");
    const [weeklyCost, setWeeklyCost] = useState("0");
    const [weeklyActive, setWeeklyActive] = useState(true);
    const [autoAssignEnabled, setAutoAssignEnabled] = useState(false);
    const [autoAssignDailyLimit, setAutoAssignDailyLimit] = useState("");
    const [coverageList, setCoverageList] = useState<UserGeoCoverage[]>([]);
    const [coverageType, setCoverageType] = useState<UserGeoCoverageType>("city");
    const [coverageCountry, setCoverageCountry] = useState("Brasil");
    const [coverageState, setCoverageState] = useState("");
    const [coverageCity, setCoverageCity] = useState("");
    const [applyToCurrentWeek, setApplyToCurrentWeek] = useState(false);
    const [weekVisitCount, setWeekVisitCount] = useState<number | null>(null);
    const [permissions, setPermissions] = useState<AdminPermissions>(() => defaultAdminPermissions());
    const [userPermissions, setUserPermissions] = useState<UserPermissions>(() => defaultUserPermissions());
    const [phoneCodes, setPhoneCodes] = useState<string[]>([]);
    const [phoneCodeInput, setPhoneCodeInput] = useState("");
    const [sharedWith, setSharedWith] = useState<UserSharedAdmin[]>([]);
    const [sharedAdminId, setSharedAdminId] = useState("");
    const [sharedPercent, setSharedPercent] = useState("50");

    useEffect(() => {
        if (!user) return;

        queueMicrotask(() => {
            setActiveTab("profile");
            setName(user.name ?? "");
            setEmail(user.email ?? "");
            setNewPassword("");
            setWhatsappPhone(user.whatsappPhone ?? "");
            setRole(user.role ?? "user");
            setActive(user.active !== false);
            setBillingMode(user.billingMode ?? "per_visit");
            setRatePerVisit(String(user.ratePerVisit ?? 0));
            setWeeklyAmount(String(user.weeklySubscriptionAmount ?? 0));
            setWeeklyCost(String(user.weeklySubscriptionCost ?? 0));
            setWeeklyActive(user.weeklySubscriptionActive !== false);
            setAutoAssignEnabled(user.autoAssignEnabled === true);
            setAutoAssignDailyLimit(
                user.autoAssignDailyLimit == null ? "" : String(user.autoAssignDailyLimit)
            );
            setCoverageList(Array.isArray(user.geoCoverage) ? user.geoCoverage : []);
            setCoverageType("city");
            setCoverageCountry("Brasil");
            setCoverageState("");
            setCoverageCity("");
            setApplyToCurrentWeek(false);
            setWeekVisitCount(null);
            setPermissions({ ...defaultAdminPermissions(), ...(user.permissions ?? {}) });
            setUserPermissions({ ...defaultUserPermissions(), ...(user.userPermissions ?? {}) });
            setPhoneCodes(Array.isArray(user.phoneCodes) ? user.phoneCodes : []);
            setPhoneCodeInput("");
            setSharedWith(Array.isArray(user.sharedWith) ? user.sharedWith : []);
            setSharedAdminId("");
            setSharedPercent("50");
        });
    }, [user]);

    // Fetch current-week visit count when billing tab is active and rate has changed
    useEffect(() => {
        if (!user || activeTab !== "billing" || billingMode !== "per_visit") return;
        const newRate = safeNumber(ratePerVisit, 0);
        const oldRate = safeNumber(user.ratePerVisit, 0);
        if (newRate === oldRate) {
            const timer = window.setTimeout(() => {
                setApplyToCurrentWeek(false);
                setWeekVisitCount(null);
            }, 0);
            return () => window.clearTimeout(timer);
        }
        const { startKey, endKey } = weekRangeKeysMonToSun();
        let cancelled = false;
        countWeekVisitedEvents(user.id, startKey, endKey).then((count) => {
            if (!cancelled) setWeekVisitCount(count);
        });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ratePerVisit, activeTab, billingMode]);

    if (!user) return null;

    const saving = savingId === user.id;

    async function save() {
        if (!user) return;

        onError(null);
        onSaving(user.id);

        const dailyLimitRaw = onlyNumberLike(autoAssignDailyLimit);
        const dailyLimit = dailyLimitRaw ? safeNumber(dailyLimitRaw, 0) : null;
        const cleanEmail = email.trim().toLowerCase();
        const cleanPassword = canManageCredentials ? newPassword.trim() : "";
        const emailChanged = cleanEmail !== String(user.email ?? "").trim().toLowerCase();

        const patch: Partial<UserDoc> = {
            name: name.trim() || "Usuario",
            email: canManageCredentials && emailChanged ? (user.email ?? "") : (user.email ?? cleanEmail),
            whatsappPhone: whatsappPhone.trim(),
            role,
            active,
            billingMode,
            ratePerVisit: safeNumber(ratePerVisit, 0),
            weeklySubscriptionAmount: safeNumber(weeklyAmount, 0),
            weeklySubscriptionCost: safeNumber(weeklyCost, 0),
            weeklySubscriptionActive: weeklyActive,
            autoAssignEnabled,
            autoAssignDailyLimit: autoAssignEnabled ? dailyLimit : null,
            geoCoverage: coverageList,
            primaryGeoCoverageLabel: coverageList[0]?.displayLabel ?? null,
        };

        try {
            if (canManageCredentials && ((emailChanged && cleanEmail) || cleanPassword)) {
                await updateManagedUserCredentials({
                    userId: user.authUid || user.id,
                    profileId: user.id,
                    email: emailChanged ? cleanEmail : undefined,
                    currentEmail: user.email,
                    password: cleanPassword || undefined,
                });
                if (emailChanged) patch.email = cleanEmail;
            }

            await updateUserProfile(user.id, patch);
            await updateUserRole(user.id, role);
            await updateUserBilling(user.id, patch);
            await updateUserAutoAssign(
                user.id,
                autoAssignEnabled,
                autoAssignEnabled ? dailyLimit : null
            );

            const normalizedCoverage = await updateUserGeoCoverage(user.id, coverageList);
            patch.geoCoverage = normalizedCoverage;
            patch.primaryGeoCoverageLabel = normalizedCoverage[0]?.displayLabel ?? null;

            if (
                applyToCurrentWeek &&
                billingMode === "per_visit" &&
                safeNumber(ratePerVisit, 0) !== safeNumber(user.ratePerVisit, 0)
            ) {
                const { startKey, endKey } = weekRangeKeysMonToSun();
                await batchUpdateWeekEventRates(user.id, startKey, endKey, safeNumber(ratePerVisit, 0));
            }

            if (role === "admin" && !user.isSuperAdmin) {
                await updateUserPermissions(user.id, permissions);
                patch.permissions = permissions;
            }

            if (role === "user") {
                await updateUserSharedWith(user.id, sharedWith);
                await updateUserVendorPermissions(user.id, userPermissions);
                await updateUserPhoneCodes(user.id, phoneCodes);
                patch.sharedWith = sharedWith;
                patch.userPermissions = userPermissions;
                patch.phoneCodes = phoneCodes;
            }

            await onPatch(user.id, patch);
            onClose();
        } catch (e: unknown) {
            onError(e instanceof Error ? e.message : "No se pudo guardar el usuario.");
        } finally {
            onSaving(null);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={`Editar ${user.name || "usuario"}`}
            subtitle="Modifica perfil, rol, auto-asignación y contabilidad."
        >
            <div className="space-y-4">
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <MiniTab icon="user" active={activeTab === "profile"} onClick={() => setActiveTab("profile")}>Perfil</MiniTab>
                    <MiniTab icon="map" active={activeTab === "coverage"} onClick={() => setActiveTab("coverage")}>Cobertura</MiniTab>
                    <MiniTab icon="shield" active={activeTab === "role"} onClick={() => setActiveTab("role")}>Rol</MiniTab>
                    <MiniTab icon="bot" active={activeTab === "autoAssign"} onClick={() => setActiveTab("autoAssign")}>Auto</MiniTab>
                    <MiniTab icon="wallet" active={activeTab === "billing"} onClick={() => setActiveTab("billing")}>Contabilidad</MiniTab>
                    {(role === "admin" && !user.isSuperAdmin) || role === "user" ? (
                        <MiniTab icon="shield" active={activeTab === "permissions"} onClick={() => setActiveTab("permissions")}>Permisos</MiniTab>
                    ) : null}
                    {role === "user" ? (
                        <MiniTab icon="link" active={activeTab === "shared"} onClick={() => setActiveTab("shared")}>Socios</MiniTab>
                    ) : null}
                </div>

                {activeTab === "profile" ? (
                    <EditorBlock title="Perfil">
                        <Field label="Nombre">
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </Field>

                        <Field label="Email">
                            <Input
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={!canManageCredentials}
                            />
                        </Field>

                        {canManageCredentials ? (
                            <Field label="Nueva contraseña">
                                <Input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Dejar vacío para no cambiar"
                                />
                            </Field>
                        ) : (
                            <p className="rounded-xl border border-[#E8E7FB] bg-[#fbfaff] px-3 py-2 text-[11px] font-semibold text-[#667085]">
                                Solo el superadmin puede cambiar credenciales de acceso.
                            </p>
                        )}

                        <Field label="WhatsApp operativo">
                            <Input
                                value={whatsappPhone}
                                onChange={(e) => setWhatsappPhone(e.target.value)}
                                placeholder="+55..."
                            />
                        </Field>
                    </EditorBlock>
                ) : null}

                {activeTab === "role" ? (
                    <EditorBlock title="Rol y acceso">
                        <div className="grid grid-cols-2 gap-2">
                            <Choice active={role === "user"} onClick={() => setRole("user")} label="Vendedor" />
                            <Choice active={role === "admin"} onClick={() => setRole("admin")} label="Admin" />
                        </div>
                    </EditorBlock>
                ) : null}

                {activeTab === "coverage" ? (
                    <>
                    <CoverageEditor
                        items={coverageList}
                        type={coverageType}
                        country={coverageCountry}
                        state={coverageState}
                        city={coverageCity}
                        onType={setCoverageType}
                        onCountry={setCoverageCountry}
                        onState={setCoverageState}
                        onCity={setCoverageCity}
                        onAdd={() => {
                            const item = buildCoverageItem({
                                type: coverageType,
                                countryLabel: coverageCountry,
                                stateLabel: coverageState,
                                cityLabel: coverageCity,
                            });

                            if (!item) {
                                onError("Completa los campos requeridos para la cobertura.");
                                return;
                            }

                            onError(null);
                            setCoverageList((prev) => [
                                item,
                                ...prev.filter((existing) => existing.id !== item.id),
                            ]);
                            const phoneCode = item.type === "country" ? countryPhoneCode(item.countryLabel) : null;
                            if (role === "user" && phoneCode) {
                                setPhoneCodes((prev) =>
                                    prev.includes(phoneCode) ? prev : [...prev, phoneCode].sort()
                                );
                            }
                            setCoverageCity("");
                        }}
                        onToggle={(id) => {
                            setCoverageList((prev) =>
                                prev.map((item) =>
                                    item.id === id ? { ...item, active: !item.active } : item
                                )
                            );
                        }}
                        onRemove={(id) => {
                            setCoverageList((prev) => prev.filter((item) => item.id !== id));
                        }}
                    />
                    {role === "user" ? (
                        <EditorBlock title="Indicativos telefónicos">
                            <p className="text-[11px] font-semibold text-[#667085]">
                                Usa DDDs de Brasil de 2 dígitos o códigos país de 3 dígitos, como 507 para Panamá. Estos clientes aparecerán en Incompletos/Chat.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {phoneCodes.length === 0 ? (
                                    <span className="text-[12px] font-semibold text-[#98A2B3]">Sin indicativos</span>
                                ) : phoneCodes.map((code) => (
                                    <span key={code} className="flex items-center gap-1 rounded-full border border-[#d9d2ff] bg-[#f3f0ff] pl-2.5 pr-1.5 py-1 text-[11px] font-black text-[#7C3AED]">
                                        {code}
                                        <button
                                            type="button"
                                            onClick={() => setPhoneCodes((prev) => prev.filter((c) => c !== code))}
                                            className="flex h-4 w-4 items-center justify-center rounded-full bg-[#7C3AED]/15 text-[#7C3AED] transition hover:bg-[#7C3AED] hover:text-white"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    value={phoneCodeInput}
                                    onChange={(e) => setPhoneCodeInput(e.target.value.replace(/\D/g, "").slice(0, 3))}
                                    placeholder="91 o 507"
                                    maxLength={3}
                                    className="h-9 w-28 rounded-lg border border-[#e4e7ec] bg-white px-3 text-[13px] font-bold text-[#344054] outline-none focus:border-[#7C3AED]"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const code = phoneCodeInput.trim();
                                        if ((code.length === 2 || code.length === 3) && !phoneCodes.includes(code)) {
                                            setPhoneCodes((prev) => [...prev, code].sort());
                                        }
                                        setPhoneCodeInput("");
                                    }}
                                    disabled={phoneCodeInput.length !== 2 && phoneCodeInput.length !== 3}
                                    className="h-9 rounded-lg border border-[#7C3AED] bg-[#7C3AED] px-4 text-[12px] font-bold text-white disabled:opacity-40"
                                >
                                    Agregar
                                </button>
                            </div>
                        </EditorBlock>
                    ) : null}
                    </>
                ) : null}

                {activeTab === "autoAssign" ? (
                    <EditorBlock title="Auto-asignación">
                        <label className="flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
                            <span className="text-[12px] font-semibold text-[#52525b]">
                                Recibir leads automáticamente
                            </span>
                            <input
                                type="checkbox"
                                checked={autoAssignEnabled}
                                onChange={(e) => setAutoAssignEnabled(e.target.checked)}
                            />
                        </label>

                        {autoAssignEnabled ? (
                            <Field label="Límite diario">
                                <Input
                                    value={autoAssignDailyLimit}
                                    onChange={(e) => setAutoAssignDailyLimit(onlyNumberLike(e.target.value))}
                                    placeholder="Vacío = sin límite"
                                />
                            </Field>
                        ) : null}
                    </EditorBlock>
                ) : null}

                {activeTab === "billing" ? (
                    <EditorBlock title="Contabilidad">
                        <div className="grid grid-cols-2 gap-2">
                            <Choice
                                active={billingMode === "per_visit"}
                                onClick={() => setBillingMode("per_visit")}
                                label="Por visita"
                            />
                            <Choice
                                active={billingMode === "weekly_subscription"}
                                onClick={() => setBillingMode("weekly_subscription")}
                                label="Suscripción"
                            />
                        </div>

                        {billingMode === "per_visit" ? (
                            <>
                            <Field label="Tarifa por visita">
                                <Input
                                    value={ratePerVisit}
                                    onChange={(e) => setRatePerVisit(onlyNumberLike(e.target.value))}
                                />
                            </Field>
                            {weekVisitCount !== null && (
                                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                                    <input
                                        type="checkbox"
                                        checked={applyToCurrentWeek}
                                        onChange={(e) => setApplyToCurrentWeek(e.target.checked)}
                                        className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                                    />
                                    <div>
                                        <p className="text-[12px] font-bold text-amber-800">
                                            Actualizar visitas de esta semana
                                        </p>
                                        <p className="mt-0.5 text-[11px] font-semibold text-amber-600">
                                            {weekVisitCount === 0
                                                ? "Sin visitas registradas esta semana."
                                                : `Aplicará la nueva tarifa a ${weekVisitCount} visita${weekVisitCount !== 1 ? "s" : ""} ya registradas en la semana actual.`}
                                        </p>
                                    </div>
                                </label>
                            )}
                            </>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Cuota semanal">
                                    <Input
                                        value={weeklyAmount}
                                        onChange={(e) => setWeeklyAmount(onlyNumberLike(e.target.value))}
                                    />
                                </Field>

                                <Field label="Costo semanal">
                                    <Input
                                        value={weeklyCost}
                                        onChange={(e) => setWeeklyCost(onlyNumberLike(e.target.value))}
                                    />
                                </Field>

                                <label className="col-span-2 flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
                                    <span className="text-[12px] font-semibold text-[#52525b]">
                                        Suscripción activa
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={weeklyActive}
                                        onChange={(e) => setWeeklyActive(e.target.checked)}
                                    />
                                </label>

                                <div className="col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-600">
                                    Neto estimado:{" "}
                                    {money(safeNumber(weeklyAmount, 0) - safeNumber(weeklyCost, 0))}
                                </div>
                            </div>
                        )}
                    </EditorBlock>
                ) : null}

                {activeTab === "permissions" && role === "user" ? (
                    <EditorBlock title="Permisos del vendedor">
                        <p className="text-[11px] font-semibold text-[#667085]">
                            Define qué pantallas puede ver este vendedor. Por defecto tiene acceso a todo.
                        </p>
                        <div className="space-y-4">
                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Pantallas</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "canSeeMap" as keyof UserPermissions, label: "Ver Mapa de prospectos" },
                                        { key: "canSeeHistory" as keyof UserPermissions, label: "Ver Historial de visitas" },
                                        { key: "canSeeChat" as keyof UserPermissions, label: "Ver Chat de clientes incompletos" },
                                        { key: "canChatWithProspects" as keyof UserPermissions, label: "Responder por chat a prospectos pendientes" },
                                        { key: "canSeeSubscriptions" as keyof UserPermissions, label: "Acceder a suscripciones" },
                                        { key: "canSeeCommercialDirectory" as keyof UserPermissions, label: "Acceder a Base Comercial" },
                                    ]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={userPermissions[key]}
                                            onChange={(val) => setUserPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setUserPermissions(fullUserPermissions())}
                                className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                            >
                                Activar todo
                            </button>
                            <button
                                type="button"
                                onClick={() => setUserPermissions({ canSeeMap: false, canSeeHistory: false, canSeeChat: false, canChatWithProspects: false, canSeeSubscriptions: false, canSeeCommercialDirectory: false })}
                                className="flex-1 rounded-lg border border-red-200 bg-red-50 py-2 text-[12px] font-semibold text-red-600 transition hover:bg-red-100"
                            >
                                Revocar todo
                            </button>
                        </div>
                    </EditorBlock>
                ) : null}

                {activeTab === "permissions" && role === "admin" && !user.isSuperAdmin ? (
                    <EditorBlock title="Permisos del administrador">
                        <p className="text-[11px] font-semibold text-[#667085]">
                            Define qué secciones y acciones puede realizar este administrador.
                        </p>

                        <div className="space-y-4">
                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Prospectos</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "prospectos", label: "Ver Prospectos" },
                                        { key: "assignmentsView", label: "Ver auditoria de asignaciones" },
                                        { key: "leadsAssign", label: "Asignar por cobertura y reasignar" },
                                        { key: "leadsWhatsapp", label: "Abrir WhatsApp de clientes" },
                                        { key: "leadsEdit", label: "Editar prospectos" },
                                        { key: "leadsStatusManage", label: "Cambiar estado del prospecto" },
                                        { key: "leadsDelete", label: "Eliminar prospectos" },
                                    ] as { key: keyof AdminPermissions; label: string }[]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={permissions[key]}
                                            onChange={(val) => setPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Actividad</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "actividad", label: "Ver pantalla de Actividad" },
                                        { key: "activityClientView", label: "Abrir perfil de cliente" },
                                        { key: "activityMaps", label: "Abrir Maps desde Actividad" },
                                        { key: "activityChat", label: "Abrir chat desde Actividad" },
                                        { key: "activityEdit", label: "Editar desde Actividad" },
                                    ] as { key: keyof AdminPermissions; label: string }[]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={permissions[key]}
                                            onChange={(val) => setPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Chat</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "chatView", label: "Acceder al Chat" },
                                    ] as { key: keyof AdminPermissions; label: string }[]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={permissions[key]}
                                            onChange={(val) => setPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Contabilidad</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "accountingView", label: "Ver su propia contabilidad" },
                                        { key: "accountingClose", label: "Cerrar y reabrir semana" },
                                        { key: "accountingInvestmentView", label: "Ver configuración de inversión" },
                                        { key: "accountingInvestmentEdit", label: "Editar configuración de inversión" },
                                    ] as { key: keyof AdminPermissions; label: string }[]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={permissions[key]}
                                            onChange={(val) => setPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Suscripciones</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "subscriptionsView", label: "Ver panel de suscripciones" },
                                        { key: "subscriptionsEdit", label: "Configurar ciudades, reglas y acciones" },
                                    ] as { key: keyof AdminPermissions; label: string }[]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={permissions[key]}
                                            onChange={(val) => setPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Directorio Comercial</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "commercialDirectoryView", label: "Ver Directorio Comercial" },
                                        { key: "commercialDirectoryEdit", label: "Crear carpetas e importar Excel" },
                                    ] as { key: keyof AdminPermissions; label: string }[]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={permissions[key]}
                                            onChange={(val) => setPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98A2B3]">Usuarios</p>
                                <div className="space-y-1.5">
                                    {([
                                        { key: "usersView", label: "Ver usuarios asignados" },
                                        { key: "usersCreate", label: "Crear nuevos usuarios" },
                                        { key: "usersEdit", label: "Editar y desactivar usuarios" },
                                    ] as { key: keyof AdminPermissions; label: string }[]).map(({ key, label }) => (
                                        <PermissionToggle
                                            key={key}
                                            label={label}
                                            value={permissions[key]}
                                            onChange={(val) => setPermissions((prev) => ({ ...prev, [key]: val }))}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setPermissions(fullAdminPermissions())}
                                className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                            >
                                Activar todo
                            </button>
                            <button
                                type="button"
                                onClick={() => setPermissions(defaultAdminPermissions())}
                                className="flex-1 rounded-lg border border-red-200 bg-red-50 py-2 text-[12px] font-semibold text-red-600 transition hover:bg-red-100"
                            >
                                Revocar todo
                            </button>
                        </div>
                    </EditorBlock>
                ) : null}

                {activeTab === "shared" && role === "user" ? (
                    <EditorBlock title="Socios administradores">
                        <p className="text-[11px] font-semibold text-[#667085]">
                            Los admins socios reciben el porcentaje indicado de la ganancia de este vendedor.
                        </p>

                        <div className="space-y-1.5">
                            {sharedWith.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-[#d4d4d8] bg-white px-3 py-4 text-center text-[12px] font-semibold text-[#71717a]">
                                    Sin socios configurados.
                                </div>
                            ) : (
                                sharedWith.map((entry) => (
                                    <div key={entry.adminId} className="flex items-center justify-between gap-3 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
                                        <div className="min-w-0">
                                            <div className="truncate text-[12px] font-semibold text-[#171717]">{entry.adminName}</div>
                                            <div className="text-[11px] font-medium text-[#9ca3af]">
                                                {entry.percentage}% de ganancia{entry.assignedAt ? ` · desde ${new Date(entry.assignedAt).toLocaleDateString("es")}` : ""}
                                            </div>
                                        </div>
                                        <IconButton
                                            icon="trash"
                                            label="Quitar socio"
                                            variant="danger"
                                            onClick={() => setSharedWith((prev) => prev.filter((e) => e.adminId !== entry.adminId))}
                                        />
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="rounded-xl border border-[#e4e7ec] bg-[#f9fafb] p-3">
                            <p className="mb-2 text-[11px] font-bold text-[#667085]">Agregar socio</p>
                            <div className="flex gap-2">
                                <select
                                    value={sharedAdminId}
                                    onChange={(e) => setSharedAdminId(e.target.value)}
                                    className="h-9 min-w-0 flex-1 rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] outline-none"
                                >
                                    <option value="">Seleccionar admin...</option>
                                    {adminUsers
                                        .filter((a) => !sharedWith.some((s) => s.adminId === a.id))
                                        .map((a) => (
                                            <option key={a.id} value={a.id}>{a.name || a.email || a.id}</option>
                                        ))}
                                </select>
                                <input
                                    value={sharedPercent}
                                    onChange={(e) => setSharedPercent(onlyNumberLike(e.target.value))}
                                    placeholder="%"
                                    className="h-9 w-16 rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] outline-none"
                                />
                                <IconButton
                                    icon="plus"
                                    label="Agregar socio"
                                    onClick={() => {
                                        const admin = adminUsers.find((a) => a.id === sharedAdminId);
                                        if (!admin) { onError("Selecciona un admin."); return; }
                                        const pct = Math.min(100, Math.max(0, safeNumber(sharedPercent, 0)));
                                        setSharedWith((prev) => [
                                            ...prev.filter((e) => e.adminId !== admin.id),
                                            { adminId: admin.id, adminName: admin.name || admin.email || admin.id, percentage: pct, assignedAt: Date.now() },
                                        ]);
                                        setSharedAdminId("");
                                        setSharedPercent("50");
                                        onError(null);
                                    }}
                                />
                            </div>
                        </div>

                        {sharedWith.length > 0 ? (
                            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-600">
                                Total asignado: {sharedWith.reduce((sum, e) => sum + e.percentage, 0)}%
                            </div>
                        ) : null}
                    </EditorBlock>
                ) : null}

                <div className="flex flex-col-reverse gap-2 border-t border-[#f0f1f2] pt-4 sm:flex-row sm:justify-end">
                    <Button
                        variant={active ? "danger" : "ghost"}
                        onClick={() => setActive((value) => !value)}
                        disabled={saving}
                        className={!active ? "border-emerald-200 text-emerald-600 hover:bg-emerald-50" : undefined}
                    >
                        {active ? "Desactivar usuario" : "Activar usuario"}
                    </Button>
                    <Button
                        variant="primary"
                        onClick={save}
                        disabled={saving}
                    >
                        {saving ? "Guardando..." : "Guardar cambios"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function CoverageEditor({
    items,
    type,
    country,
    state,
    city,
    onType,
    onCountry,
    onState,
    onCity,
    onAdd,
    onToggle,
    onRemove,
}: {
    items: UserGeoCoverage[];
    type: UserGeoCoverageType;
    country: string;
    state: string;
    city: string;
    onType: (value: UserGeoCoverageType) => void;
    onCountry: (value: string) => void;
    onState: (value: string) => void;
    onCity: (value: string) => void;
    onAdd: () => void;
    onToggle: (id: string) => void;
    onRemove: (id: string) => void;
}) {
    return (
        <EditorBlock title="Cobertura geográfica">
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tipo">
                    <select
                        value={type}
                        onChange={(e) => onType(e.target.value as UserGeoCoverageType)}
                        className="h-9 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] outline-none"
                    >
                        <option value="city">Ciudad</option>
                        <option value="state">Estado</option>
                        <option value="country">País</option>
                    </select>
                </Field>

                <Field label="País">
                    <Input value={country} onChange={(e) => onCountry(e.target.value)} />
                </Field>

                {type !== "country" ? (
                    <Field label="Estado">
                        <Input
                            value={state}
                            onChange={(e) => onState(e.target.value)}
                            placeholder="Ej: Pernambuco"
                        />
                    </Field>
                ) : null}
            </div>

            {type === "city" ? (
                <Field label="Ciudad">
                    <Input
                        value={city}
                        onChange={(e) => onCity(e.target.value)}
                        placeholder="Ej: Recife"
                    />
                </Field>
            ) : null}

            <div className="flex justify-end">
                <IconButton icon="plus" label="Agregar cobertura" onClick={onAdd} />
            </div>

            <div className="space-y-2">
                {items.length ? (
                    items.map((item) => (
                        <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2"
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <Badge tone={item.active === false ? "gray" : "green"}>
                                        {item.active === false ? "Pausada" : "Activa"}
                                    </Badge>
                                    <span className="truncate text-[12px] font-semibold text-[#171717]">
                                        {item.displayLabel}
                                    </span>
                                </div>
                                <div className="mt-0.5 text-[11px] font-medium text-[#9ca3af]">
                                    {item.type === "city"
                                        ? "Ciudad"
                                        : item.type === "state"
                                            ? "Estado"
                                            : "País"}
                                </div>
                            </div>

                            <div className="flex shrink-0 gap-2">
                                <IconButton
                                    icon="power"
                                    label={
                                        item.active === false
                                            ? "Activar cobertura"
                                            : "Pausar cobertura"
                                    }
                                    onClick={() => onToggle(item.id)}
                                />
                                <IconButton
                                    icon="trash"
                                    label="Quitar cobertura"
                                    variant="danger"
                                    onClick={() => onRemove(item.id)}
                                />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="rounded-lg border border-dashed border-[#d4d4d8] bg-white px-3 py-6 text-center text-[12px] font-semibold text-[#71717a]">
                        Sin coberturas configuradas.
                    </div>
                )}
            </div>
        </EditorBlock>
    );
}

function EditorBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-3 rounded-2xl border border-[#e4e7ec] bg-gradient-to-b from-white to-[#fbfaff] p-3 shadow-sm">
            <p className="text-[12px] font-semibold text-[#171717]">{title}</p>
            {children}
        </div>
    );
}

function Choice({
    active,
    label,
    onClick,
}: {
    active: boolean;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                active
                    ? "rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12px] font-semibold text-[#7C3AED] transition"
                    : "rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-semibold text-[#52525b] transition hover:bg-[#f9fafb]"
            }
        >
            {label}
        </button>
    );
}

function PermissionToggle({
    label,
    value,
    onChange,
}: {
    label: string;
    value?: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
            <span className="text-[12px] font-semibold text-[#52525b]">{label}</span>
            <input
                type="checkbox"
                checked={!!value}
                onChange={(e) => onChange(e.target.checked)}
                className="h-4 w-4 accent-violet-600"
            />
        </label>
    );
}

function MiniTab({
    active,
    children,
    icon,
    onClick,
}: {
    active: boolean;
    children: ReactNode;
    icon: IconName;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                active
                    ? "inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#2563eb] px-3 py-2 text-[11px] font-semibold text-white shadow-sm"
                    : "inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#e5e7eb] bg-white px-2 py-2 text-[11px] font-semibold text-[#71717a] hover:bg-[#f8f7ff] hover:text-[#4f46e5]"
            }
        >
            <Icon name={icon} />
            <span className={[
                "overflow-hidden transition-all duration-200",
                active ? "max-w-[80px] opacity-100" : "max-w-0 opacity-0",
            ].join(" ")}>
                {children}
            </span>
        </button>
    );
}
