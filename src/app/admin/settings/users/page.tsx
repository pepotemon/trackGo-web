"use client";

import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import {
    createUserProfile,
    listAdminUsers,
    toggleUserActive,
    updateUserAutoAssign,
    updateUserBilling,
    updateUserGeoCoverage,
    updateUserProfile,
    updateUserRole,
} from "@/data/usersRepo";
import type { UserBillingMode, UserDoc, UserGeoCoverage, UserGeoCoverageType, UserRole } from "@/types/users";
import {
    Badge,
    Button,
    Card,
    Field,
    Input,
    Modal,
    PageHeader,
    StatCard,
} from "@/components/ui";

type EditorTab = "profile" | "coverage" | "role" | "autoAssign" | "billing";
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
    | "wallet";

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

function coverageLabel(user: UserDoc) {
    const items = Array.isArray(user.geoCoverage) ? user.geoCoverage : [];
    if (!items.length) return "Sin cobertura";

    const active = items.filter((item) => item.active !== false);
    const visible = (active.length ? active : items)
        .slice(0, 2)
        .map((item) => item.displayLabel || item.cityLabel || item.stateLabel || item.countryLabel)
        .filter(Boolean);

    if (!visible.length) return "Sin cobertura";
    return items.length > 2 ? `${visible.join(" - ")} +${items.length - 2}` : visible.join(" - ");
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
        id: [type, countryNormalized || "all", stateNormalized || "all", cityNormalized || "all"].join("__"),
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
            {name === "shield" ? <path {...common} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /> : null}
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
        </svg>
    );
}

function IconButton({
    icon,
    label,
    variant = "secondary",
    className = "",
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: IconName;
    label: string;
    variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
    return (
        <Button
            type="button"
            variant={variant}
            aria-label={label}
            title={label}
            className={`h-9 w-9 px-0 py-0 ${className}`}
            {...props}
        >
            <Icon name={icon} />
        </Button>
    );
}

export default function UsersPage() {
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);

    const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
    const [autoFilter, setAutoFilter] = useState<AutoFilter>("all");
    const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");

    const selectedUser = useMemo(
        () => users.find((u) => u.id === selectedUserId) ?? null,
        [users, selectedUserId]
    );

    const filteredUsers = useMemo(() => {
        const q = norm(search);

        return users.filter((u) => {
            if (roleFilter !== "all" && u.role !== roleFilter) return false;

            const autoEnabled = u.autoAssignEnabled === true;
            if (autoFilter === "on" && !autoEnabled) return false;
            if (autoFilter === "off" && autoEnabled) return false;

            if (billingFilter !== "all" && u.billingMode !== billingFilter) {
                return false;
            }

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
    }, [users, search, roleFilter, autoFilter, billingFilter]);

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
            total: users.length,
            active: users.filter((u) => u.active).length,
            admins: users.filter((u) => u.role === "admin").length,
            weekly: users.filter((u) => u.billingMode === "weekly_subscription")
                .length,
        };
    }, [users]);

    const activeFiltersCount = useMemo(() => {
        let total = 0;
        if (roleFilter !== "all") total++;
        if (autoFilter !== "all") total++;
        if (billingFilter !== "all") total++;
        if (search.trim()) total++;
        return total;
    }, [roleFilter, autoFilter, billingFilter, search]);

    async function patchUserLocal(userId: string, patch: Partial<UserDoc>) {
        setUsers((prev) =>
            prev.map((u) => (u.id === userId ? { ...u, ...patch } : u))
        );
    }

    async function handleToggleActive(user: UserDoc) {
        const next = !user.active;
        setSavingId(user.id);

        try {
            await toggleUserActive(user.id, next);
            await patchUserLocal(user.id, { active: next });
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : "No se pudo actualizar el usuario.");
        } finally {
            setSavingId(null);
        }
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

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Usuarios"
                actions={
                    <>
                        <IconButton icon="refresh" label="Actualizar" onClick={loadUsers} />
                        <IconButton
                            icon="plus"
                            label="Crear usuario"
                            variant="primary"
                            onClick={() => setCreateOpen(true)}
                        />
                    </>
                }
            />

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            <section className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Usuarios" value={stats.total} caption="Total registrado" />
                <StatCard label="Activos" value={stats.active} caption="Usuarios operativos" />
                <StatCard label="Admins" value={stats.admins} caption="Permisos admin" />
                <StatCard label="Suscripción" value={stats.weekly} caption="Modelo semanal" />
            </section>

            <section>
                <Card className="overflow-hidden">
                    <div className="flex flex-col gap-4 px-4 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <h2 className="text-[14px] font-semibold text-[#171717]">
                                    Equipo
                                </h2>
                                <p className="mt-0.5 text-[12px] font-medium text-[#9ca3af]">
                                    Busca, filtra y selecciona un usuario para editarlo.
                                </p>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar usuario..."
                                    className="sm:w-[280px]"
                                />

                                {activeFiltersCount > 0 ? (
                                    <IconButton icon="x" label="Limpiar filtros" onClick={resetFilters} />
                                ) : null}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <FilterGroup label="Rol">
                                <FilterPill active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
                                    Todos
                                </FilterPill>
                                <FilterPill active={roleFilter === "admin"} onClick={() => setRoleFilter("admin")}>
                                    Admins
                                </FilterPill>
                                <FilterPill active={roleFilter === "user"} onClick={() => setRoleFilter("user")}>
                                    Vendedores
                                </FilterPill>
                            </FilterGroup>

                            <FilterGroup label="Auto">
                                <FilterPill active={autoFilter === "all"} onClick={() => setAutoFilter("all")}>
                                    Todos
                                </FilterPill>
                                <FilterPill active={autoFilter === "on"} onClick={() => setAutoFilter("on")}>
                                    ON
                                </FilterPill>
                                <FilterPill active={autoFilter === "off"} onClick={() => setAutoFilter("off")}>
                                    OFF
                                </FilterPill>
                            </FilterGroup>

                            <FilterGroup label="Cobro">
                                <FilterPill active={billingFilter === "all"} onClick={() => setBillingFilter("all")}>
                                    Todos
                                </FilterPill>
                                <FilterPill active={billingFilter === "per_visit"} onClick={() => setBillingFilter("per_visit")}>
                                    Por visita
                                </FilterPill>
                                <FilterPill active={billingFilter === "weekly_subscription"} onClick={() => setBillingFilter("weekly_subscription")}>
                                    Suscripción
                                </FilterPill>
                            </FilterGroup>
                        </div>
                    </div>

                    <div className="overflow-x-auto border-t border-[#f0f1f2]">
                        <table className="w-full min-w-[1040px] border-collapse">
                            <thead>
                                <tr className="border-b border-[#f0f1f2] text-left text-[11px] font-medium text-[#9ca3af]">
                                    <th className="px-4 py-3">Usuario</th>
                                    <th className="px-4 py-3">Rol</th>
                                    <th className="px-4 py-3">Estado</th>
                                    <th className="px-4 py-3">Modelo</th>
                                    <th className="px-4 py-3">Cobertura</th>
                                    <th className="px-4 py-3">Auto</th>
                                    <th className="px-4 py-3 text-right">Acción</th>
                                </tr>
                            </thead>

                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                            Cargando usuarios…
                                        </td>
                                    </tr>
                                ) : filteredUsers.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-[13px] font-medium text-[#71717a]">
                                            No hay usuarios con ese filtro.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredUsers.map((u) => {
                                        const selected = selectedUserId === u.id;
                                        const autoEnabled = u.autoAssignEnabled === true;

                                        return (
                                            <tr
                                                key={u.id}
                                                onClick={() => setSelectedUserId(u.id)}
                                                className={
                                                    selected
                                                        ? "cursor-pointer border-b border-[#f0f1f2] bg-[#f4f7ff] last:border-0"
                                                        : "cursor-pointer border-b border-[#f0f1f2] last:border-0 hover:bg-[#fafafa]"
                                                }
                                            >
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-[12px] font-semibold text-white">
                                                            {(u.name || u.email || "U").slice(0, 1).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="truncate text-[12px] font-semibold text-[#171717]">
                                                                {u.name || "Usuario"}
                                                            </div>
                                                            <div className="mt-0.5 truncate text-[11px] font-medium text-[#9ca3af]">
                                                                {u.email || u.id}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <Badge tone={u.role === "admin" ? "blue" : "gray"}>
                                                        {u.role === "admin" ? "Admin" : "Vendedor"}
                                                    </Badge>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <Badge tone={u.active ? "green" : "red"}>
                                                        {u.active ? "Activo" : "Inactivo"}
                                                    </Badge>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <Badge tone="gray">
                                                        {u.billingMode === "weekly_subscription" ? "Suscripción" : "Por visita"}
                                                    </Badge>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <div className="max-w-[220px] truncate text-[12px] font-semibold text-[#52525b]">
                                                        {coverageLabel(u)}
                                                    </div>
                                                </td>

                                                <td className="px-4 py-3">
                                                    <Badge tone={autoEnabled ? "green" : "gray"}>
                                                        {autoEnabled ? "Auto ON" : "Auto OFF"}
                                                    </Badge>
                                                </td>

                                                <td className="px-4 py-3 text-right">
                                                    <IconButton
                                                        icon="power"
                                                        label={u.active ? "Desactivar usuario" : "Activar usuario"}
                                                        variant={u.active ? "danger" : "secondary"}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleToggleActive(u);
                                                        }}
                                                        disabled={savingId === u.id}
                                                        className={u.active ? "" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </section>

            <EditUserModal
                user={selectedUser}
                open={!!selectedUser}
                savingId={savingId}
                onClose={() => setSelectedUserId(null)}
                onSaving={setSavingId}
                onPatch={patchUserLocal}
                onError={setErr}
            />

            <CreateUserModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={handleCreated}
                onError={setErr}
            />
        </div>
    );
}

function FilterGroup({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="inline-flex items-center gap-1 rounded-xl border border-[#e5e7eb] bg-[#f4f5f6] p-1">
            <span className="px-2 text-[11px] font-semibold text-[#71717a]">
                {label}
            </span>
            {children}
        </div>
    );
}

function FilterPill({
    active,
    children,
    onClick,
}: {
    active: boolean;
    children: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                active
                    ? "rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-[#171717] shadow-sm"
                    : "rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[#71717a] transition hover:bg-white/70 hover:text-[#171717]"
            }
        >
            {children}
        </button>
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
    const [userId, setUserId] = useState("");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [whatsappPhone, setWhatsappPhone] = useState("");
    const [role, setRole] = useState<UserRole>("user");
    const [active, setActive] = useState(true);
    const [saving, setSaving] = useState(false);

    async function create() {
        const cleanId = userId.trim();

        if (!cleanId) {
            onError("Debes colocar el UID del usuario de Firebase Auth.");
            return;
        }

        setSaving(true);
        onError(null);

        try {
            const created = await createUserProfile(cleanId, {
                name: name.trim() || "Usuario",
                email: email.trim(),
                whatsappPhone: whatsappPhone.trim(),
                role,
                active,
            });

            onCreated(created);

            setUserId("");
            setName("");
            setEmail("");
            setWhatsappPhone("");
            setRole("user");
            setActive(true);
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
            subtitle="Crea el perfil administrativo usando el UID real de Firebase Auth."
        >
            <div className="space-y-4">
                <Field label="UID de Firebase Auth">
                    <Input
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        placeholder="Ej: R8ds9..."
                    />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nombre">
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </Field>

                    <Field label="Email">
                        <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                    </Field>
                </div>

                <Field label="WhatsApp operativo">
                    <Input
                        value={whatsappPhone}
                        onChange={(e) => setWhatsappPhone(e.target.value)}
                        placeholder="+55..."
                    />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Choice active={role === "user"} onClick={() => setRole("user")} label="Vendedor" />
                    <Choice active={role === "admin"} onClick={() => setRole("admin")} label="Admin" />
                </div>

                <label className="flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-2">
                    <span className="text-[12px] font-semibold text-[#52525b]">
                        Usuario activo
                    </span>
                    <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                    />
                </label>

                <div className="flex justify-end gap-2 border-t border-[#f0f1f2] pt-4">
                    <IconButton icon="x" label="Cancelar" onClick={onClose} />
                    <IconButton
                        icon="check"
                        label={saving ? "Creando" : "Crear usuario"}
                        variant="primary"
                        onClick={create}
                        disabled={saving}
                    />
                </div>
            </div>
        </Modal>
    );
}

function EditUserModal({
    user,
    open,
    savingId,
    onClose,
    onSaving,
    onPatch,
    onError,
}: {
    user: UserDoc | null;
    open: boolean;
    savingId: string | null;
    onClose: () => void;
    onSaving: (id: string | null) => void;
    onPatch: (userId: string, patch: Partial<UserDoc>) => Promise<void>;
    onError: (msg: string | null) => void;
}) {
    const [activeTab, setActiveTab] = useState<EditorTab>("profile");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [whatsappPhone, setWhatsappPhone] = useState("");
    const [role, setRole] = useState<UserRole>("user");
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

    useEffect(() => {
        if (!user) return;

        queueMicrotask(() => {
            setActiveTab("profile");
            setName(user.name ?? "");
            setEmail(user.email ?? "");
            setWhatsappPhone(user.whatsappPhone ?? "");
            setRole(user.role ?? "user");
            setBillingMode(user.billingMode ?? "per_visit");
            setRatePerVisit(String(user.ratePerVisit ?? 0));
            setWeeklyAmount(String(user.weeklySubscriptionAmount ?? 0));
            setWeeklyCost(String(user.weeklySubscriptionCost ?? 0));
            setWeeklyActive(user.weeklySubscriptionActive !== false);
            setAutoAssignEnabled(user.autoAssignEnabled === true);
            setAutoAssignDailyLimit(
                user.autoAssignDailyLimit == null
                    ? ""
                    : String(user.autoAssignDailyLimit)
            );
            setCoverageList(Array.isArray(user.geoCoverage) ? user.geoCoverage : []);
            setCoverageType("city");
            setCoverageCountry("Brasil");
            setCoverageState("");
            setCoverageCity("");
        });
    }, [user]);

    if (!user) return null;

    const saving = savingId === user.id;

    async function save() {
        if (!user) return;

        onError(null);
        onSaving(user.id);

        const dailyLimitRaw = onlyNumberLike(autoAssignDailyLimit);
        const dailyLimit = dailyLimitRaw ? safeNumber(dailyLimitRaw, 0) : null;

        const patch: Partial<UserDoc> = {
            name: name.trim() || "Usuario",
            email: email.trim(),
            whatsappPhone: whatsappPhone.trim(),
            role,
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
                <div className="flex flex-wrap gap-2">
                    <MiniTab icon="user" active={activeTab === "profile"} onClick={() => setActiveTab("profile")}>
                        Perfil
                    </MiniTab>
                    <MiniTab icon="map" active={activeTab === "coverage"} onClick={() => setActiveTab("coverage")}>
                        Cobertura
                    </MiniTab>
                    <MiniTab icon="shield" active={activeTab === "role"} onClick={() => setActiveTab("role")}>
                        Rol
                    </MiniTab>
                    <MiniTab icon="bot" active={activeTab === "autoAssign"} onClick={() => setActiveTab("autoAssign")}>
                        Auto
                    </MiniTab>
                    <MiniTab icon="wallet" active={activeTab === "billing"} onClick={() => setActiveTab("billing")}>
                        Contabilidad
                    </MiniTab>
                </div>

                {activeTab === "profile" ? (
                    <EditorBlock title="Perfil">
                        <Field label="Nombre">
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </Field>

                        <Field label="Email">
                            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                        </Field>

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
                            <Choice active={billingMode === "per_visit"} onClick={() => setBillingMode("per_visit")} label="Por visita" />
                            <Choice active={billingMode === "weekly_subscription"} onClick={() => setBillingMode("weekly_subscription")} label="Suscripción" />
                        </div>

                        {billingMode === "per_visit" ? (
                            <Field label="Tarifa por visita">
                                <Input value={ratePerVisit} onChange={(e) => setRatePerVisit(onlyNumberLike(e.target.value))} />
                            </Field>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Cuota semanal">
                                    <Input value={weeklyAmount} onChange={(e) => setWeeklyAmount(onlyNumberLike(e.target.value))} />
                                </Field>

                                <Field label="Costo semanal">
                                    <Input value={weeklyCost} onChange={(e) => setWeeklyCost(onlyNumberLike(e.target.value))} />
                                </Field>

                                <label className="col-span-2 flex items-center justify-between rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
                                    <span className="text-[12px] font-semibold text-[#52525b]">
                                        Suscripción activa
                                    </span>
                                    <input type="checkbox" checked={weeklyActive} onChange={(e) => setWeeklyActive(e.target.checked)} />
                                </label>

                                <div className="col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-600">
                                    Neto estimado: {money(safeNumber(weeklyAmount, 0) - safeNumber(weeklyCost, 0))}
                                </div>
                            </div>
                        )}
                    </EditorBlock>
                ) : null}

                <div className="flex justify-end gap-2 border-t border-[#f0f1f2] pt-4">
                    <IconButton icon="x" label="Cancelar" onClick={onClose} />
                    <IconButton
                        icon="check"
                        label={saving ? "Guardando" : "Guardar cambios"}
                        variant="primary"
                        onClick={save}
                        disabled={saving}
                    />
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
        <EditorBlock title="Cobertura geografica">
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tipo">
                    <select
                        value={type}
                        onChange={(e) => onType(e.target.value as UserGeoCoverageType)}
                        className="h-9 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] outline-none"
                    >
                        <option value="city">Ciudad</option>
                        <option value="state">Estado</option>
                        <option value="country">Pais</option>
                    </select>
                </Field>

                <Field label="Pais">
                    <Input value={country} onChange={(e) => onCountry(e.target.value)} />
                </Field>

                {type !== "country" ? (
                    <Field label="Estado">
                        <Input value={state} onChange={(e) => onState(e.target.value)} placeholder="Ej: Pernambuco" />
                    </Field>
                ) : null}
            </div>

            {type === "city" ? (
                <Field label="Ciudad">
                    <Input value={city} onChange={(e) => onCity(e.target.value)} placeholder="Ej: Recife" />
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
                                    {item.type === "city" ? "Ciudad" : item.type === "state" ? "Estado" : "Pais"}
                                </div>
                            </div>

                            <div className="flex shrink-0 gap-2">
                                <IconButton
                                    icon="power"
                                    label={item.active === false ? "Activar cobertura" : "Pausar cobertura"}
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

function EditorBlock({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-3 rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-3">
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
                    ? "rounded-lg border border-[#171717] bg-black px-3 py-2 text-[12px] font-semibold text-white"
                    : "rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-semibold text-[#52525b] transition hover:bg-[#f9fafb]"
            }
        >
            {label}
        </button>
    );
}

function MiniTab({
    active,
    children,
    icon,
    onClick,
}: {
    active: boolean;
    children: React.ReactNode;
    icon: IconName;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                active
                    ? "inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-[11px] font-semibold text-white"
                    : "inline-flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#71717a] hover:bg-[#f9fafb]"
            }
        >
            <Icon name={icon} />
            {children}
        </button>
    );
}
