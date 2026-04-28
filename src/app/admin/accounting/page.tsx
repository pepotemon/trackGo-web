"use client";

import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { weekRangeKeysMonToSat, addDays, money } from "@/lib/date";
import {
    getWeeklyInvestment,
    listInvestmentGroups,
    listAccountingUsers,
    listDailyEventsByRange,
    upsertInvestmentGroup,
    upsertWeeklyInvestment,
} from "@/data/accountingRepo";
import { buildAccountingSummary } from "@/features/accounting/calcAccounting";
import type {
    AccountingSummary,
    DailyEventDoc,
    InvestmentGroupDoc,
    UserDoc,
    WeeklyInvestmentDoc,
    WeeklyInvestmentGroup,
} from "@/types/accounting";
import {
    Badge,
    Button,
    Card,
    CardHeader,
    Field,
    Input,
    Modal,
    PageHeader,
    PageTab,
    StatCard,
} from "@/components/ui";

type AccountingTab = "overview" | "investment";
type IconName = "check" | "plus" | "settings" | "edit" | "pause" | "play" | "x";
type GroupDraft = {
    id: string;
    name: string;
    amount: string;
    userIds: string[];
    active: boolean;
};

function shiftWeek(base: Date, offset: number) {
    return addDays(base, offset * 7);
}

function formatPercent(value: number | null) {
    if (value == null || !Number.isFinite(value)) return "—";
    return `${value.toFixed(1)}%`;
}

function summaryNumber(summary: AccountingSummary, key: keyof AccountingSummary) {
    const value = summary[key];
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export default function AccountingPage() {
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    const [activeTab, setActiveTab] = useState<AccountingTab>("overview");
    const [weekOffset, setWeekOffset] = useState(0);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [investment, setInvestment] = useState<WeeklyInvestmentDoc | null>(null);
    const [investmentGroups, setInvestmentGroups] = useState<InvestmentGroupDoc[]>([]);

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const week = useMemo(() => {
        return weekRangeKeysMonToSat(shiftWeek(new Date(), weekOffset));
    }, [weekOffset]);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            setFirebaseUser(user);
            setAuthChecked(true);

            if (!user) {
                setIsAdmin(false);
                return;
            }

            try {
                const snap = await getDoc(doc(db, "users", user.uid));
                const data = snap.exists() ? (snap.data() as { role?: unknown; active?: unknown }) : null;
                setIsAdmin(data?.role === "admin" && data?.active === true);
            } catch {
                setIsAdmin(false);
            }
        });

        return () => unsub();
    }, []);

    useEffect(() => {
        if (!authChecked || !firebaseUser || !isAdmin) return;

        let cancelled = false;

        async function load() {
            setLoading(true);
            setErr(null);

            try {
                const [u, ev, inv, groupCatalog] = await Promise.all([
                    listAccountingUsers(),
                    listDailyEventsByRange(week.startKey, week.endKey),
                    getWeeklyInvestment(week.startKey),
                    listInvestmentGroups(),
                ]);

                if (cancelled) return;

                setUsers(u);
                setEvents(ev);
                setInvestment(inv);
                setInvestmentGroups(groupCatalog);
            } catch (e: unknown) {
                if (cancelled) return;
                setErr(e instanceof Error ? e.message : "No se pudo cargar la contabilidad.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();

        return () => {
            cancelled = true;
        };
    }, [authChecked, firebaseUser, isAdmin, week.startKey, week.endKey]);

    const summary: AccountingSummary | null = useMemo(() => {
        if (!firebaseUser || !isAdmin) return null;

        return buildAccountingSummary({
            startKey: week.startKey,
            endKey: week.endKey,
            users,
            events,
            investment,
        });
    }, [firebaseUser, isAdmin, week.startKey, week.endKey, users, events, investment]);

    if (!authChecked) {
        return <ScreenShell>Cargando acceso…</ScreenShell>;
    }

    if (!firebaseUser) {
        return (
            <ScreenShell>
                <Card className="mx-auto max-w-md p-8 text-center">
                    <h1 className="text-[22px] font-semibold text-[#171717]">TrackGo Admin</h1>
                    <p className="mt-2 text-[13px] font-medium text-[#71717a]">
                        Inicia sesión para ver la contabilidad.
                    </p>
                </Card>
            </ScreenShell>
        );
    }

    if (!isAdmin) {
        return (
            <ScreenShell>
                <Card className="mx-auto max-w-md border-red-200 p-8 text-center">
                    <h1 className="text-[22px] font-semibold text-[#171717]">Sin acceso</h1>
                    <p className="mt-2 text-[13px] font-medium text-red-500">
                        Tu usuario no tiene permisos de administrador.
                    </p>
                    <Button onClick={() => signOut(auth)} className="mt-5">
                        Salir
                    </Button>
                </Card>
            </ScreenShell>
        );
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Contabilidad"
                tabs={
                    <>
                        <PageTab active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
                            Vision general
                        </PageTab>
                        <PageTab active={activeTab === "investment"} onClick={() => setActiveTab("investment")}>
                            Inversion
                        </PageTab>
                    </>
                }
                actions={
                    <>
                        <Button onClick={() => setActiveTab("investment")}>Configurar inversion</Button>
                        <Button onClick={() => signOut(auth)}>Salir</Button>
                    </>
                }
            />

            <section className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <Button>Semana {week.startKey} → {week.endKey}</Button>
                    <Button onClick={() => setWeekOffset((v) => v - 1)}>← Anterior</Button>
                    <Button onClick={() => setWeekOffset(0)} className="text-[#171717]">
                        Actual
                    </Button>
                    <Button onClick={() => setWeekOffset((v) => v + 1)}>Siguiente →</Button>
                </div>

                <div className="flex items-center gap-2">
                    <Button>{users.length} usuarios</Button>
                    <Button>{events.length} eventos</Button>
                </div>
            </section>

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            {loading || !summary ? (
                <Card className="p-6 text-[13px] font-medium text-[#71717a]">
                    Cargando contabilidad…
                </Card>
            ) : (
                activeTab === "overview" ? (
                    <DashboardContent summary={summary} investment={investment} />
                ) : (
                    <InvestmentContent
                        weekStartKey={week.startKey}
                        weekEndKey={week.endKey}
                        users={users}
                        investment={investment}
                        investmentGroups={investmentGroups}
                        onSaved={(next) => {
                            setInvestment(next);
                        }}
                        onGroupsSaved={setInvestmentGroups}
                        onError={setErr}
                    />
                )
            )}
        </div>
    );
}

function InvestmentContent({
    weekStartKey,
    weekEndKey,
    users,
    investment,
    investmentGroups,
    onSaved,
    onGroupsSaved,
    onError,
}: {
    weekStartKey: string;
    weekEndKey: string;
    users: UserDoc[];
    investment: WeeklyInvestmentDoc | null;
    investmentGroups: InvestmentGroupDoc[];
    onSaved: (investment: WeeklyInvestmentDoc) => void;
    onGroupsSaved: (groups: InvestmentGroupDoc[]) => void;
    onError: (message: string | null) => void;
}) {
    const [amount, setAmount] = useState("0");
    const [groups, setGroups] = useState<GroupDraft[]>([]);
    const [budgetOpen, setBudgetOpen] = useState(false);
    const [groupOpen, setGroupOpen] = useState(false);
    const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        queueMicrotask(() => {
            const drafts = investmentGroups.length
                ? catalogGroupsToDrafts(investmentGroups)
                : groupsToDrafts(investment?.groups);
            const activeAmount = drafts
                .filter((group) => group.active)
                .reduce((sum, group) => sum + parseMoney(group.amount), 0);

            setAmount(String(activeAmount || investment?.amount || 0));
            setGroups(drafts);
        });
    }, [investment, investmentGroups, weekStartKey]);

    const validGroups = useMemo(() => draftToGroups(groups), [groups]);
    const budget = useMemo(() => parseMoney(amount), [amount]);
    const assigned = useMemo(
        () => validGroups.reduce((sum, group) => sum + group.amount, 0),
        [validGroups]
    );
    const remaining = Math.round((budget - assigned) * 100) / 100;

    function openCreateGroup() {
        setGroupDraft({
            id: makeGroupId(),
            name: `Grupo ${groups.length + 1}`,
            amount: "",
            userIds: [],
            active: true,
        });
        setGroupOpen(true);
    }

    function openEditGroup(group: GroupDraft) {
        setGroupDraft({ ...group, userIds: [...group.userIds] });
        setGroupOpen(true);
    }

    function updateGroupInList(groupId: string, patch: Partial<GroupDraft>) {
        setGroups((prev) =>
            prev.map((group) => (group.id === groupId ? { ...group, ...patch } : group))
        );
    }

    function updateGroupDraft(patch: Partial<GroupDraft>) {
        setGroupDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    }

    function toggleDraftUser(userId: string) {
        setGroupDraft((prev) => {
            if (!prev) return prev;
            const hasUser = prev.userIds.includes(userId);
            return {
                ...prev,
                userIds: hasUser
                    ? prev.userIds.filter((id) => id !== userId)
                    : [...prev.userIds, userId],
            };
        });
    }

    async function saveBudget() {
        onError(null);

        if (budget < 0) {
            onError("El presupuesto no puede ser negativo.");
            return;
        }

        setSaving(true);

        try {
            const next = await upsertWeeklyInvestment({
                weekStartKey,
                weekEndKey,
                amount: budget,
                groups: validGroups,
            });
            onSaved(next);
            setBudgetOpen(false);
        } catch (error) {
            onError(error instanceof Error ? error.message : "No se pudo guardar la inversion.");
        } finally {
            setSaving(false);
        }
    }

    async function saveGroup() {
        if (!groupDraft) return;

        onError(null);
        setSaving(true);

        try {
            const savedGroup = await upsertInvestmentGroup({
                id: groupDraft.id,
                name: groupDraft.name,
                defaultAmount: parseMoney(groupDraft.amount),
                userIds: groupDraft.userIds,
                status: groupDraft.active ? "active" : "inactive",
            });
            const nextGroups = upsertDraft(groups, groupDraft);
            const nextInvestment = await upsertWeeklyInvestment({
                weekStartKey,
                weekEndKey,
                amount: budget,
                groups: draftToGroups(nextGroups),
            });

            setGroups(nextGroups);
            onGroupsSaved(upsertCatalogGroup(investmentGroups, savedGroup));
            onSaved(nextInvestment);
            setGroupOpen(false);
            setGroupDraft(null);
        } catch (error) {
            onError(error instanceof Error ? error.message : "No se pudo guardar el grupo.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-4">
            <section className="grid gap-4 md:grid-cols-3">
                <StatCard label="Presupuesto" value={money(budget)} caption={`${weekStartKey} a ${weekEndKey}`} />
                <StatCard label="Asignado" value={money(assigned)} caption={`${validGroups.length} grupos validos`} />
                <StatCard
                    label="Restante"
                    value={money(remaining)}
                    caption={Math.abs(remaining) <= 0.01 ? "Distribucion completa" : "Falta cuadrar"}
                />
            </section>

            <Card className="overflow-hidden">
                <CardHeader
                    title="Inversion semanal"
                    subtitle="Presupuesto general de la semana y distribucion aplicada."
                    action={
                        <IconButton
                            icon="settings"
                            label="Configurar inversion"
                            variant="primary"
                            onClick={() => setBudgetOpen(true)}
                        />
                    }
                />

                <div className="grid gap-4 border-t border-[#f0f1f2] p-4 md:grid-cols-3">
                    <MiniInvestmentStat label="Presupuesto general" value={money(budget)} />
                    <MiniInvestmentStat label="Asignado a grupos" value={money(assigned)} />
                    <MiniInvestmentStat
                        label="Disponible"
                        value={money(remaining)}
                        tone={remaining >= 0 ? "green" : "red"}
                    />
                </div>
            </Card>

            <Card className="overflow-hidden">
                <CardHeader
                    title="Grupos de inversion"
                    subtitle="Cada grupo se configura y se activa de forma individual."
                    action={
                        <IconButton
                            icon="plus"
                            label="Crear grupo"
                            variant="primary"
                            onClick={openCreateGroup}
                        />
                    }
                />

                <div className="border-t border-[#f0f1f2] p-4">
                    {groups.length ? (
                        <div className="grid gap-3 xl:grid-cols-2">
                            {groups.map((group, index) => (
                                <InvestmentGroupManageCard
                                    key={group.id}
                                    index={index}
                                    group={group}
                                    onEdit={() => openEditGroup(group)}
                                    onToggleActive={async () => {
                                        const nextGroup = { ...group, active: !group.active };
                                        const nextGroups = upsertDraft(groups, nextGroup);
                                        updateGroupInList(group.id, { active: nextGroup.active });
                                        await upsertInvestmentGroup({
                                            id: nextGroup.id,
                                            name: nextGroup.name,
                                            defaultAmount: parseMoney(nextGroup.amount),
                                            userIds: nextGroup.userIds,
                                            status: nextGroup.active ? "active" : "inactive",
                                        });
                                        const nextInvestment = await upsertWeeklyInvestment({
                                            weekStartKey,
                                            weekEndKey,
                                            amount: budget,
                                            groups: draftToGroups(nextGroups),
                                        });
                                        onSaved(nextInvestment);
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-[#d4d4d8] bg-white px-4 py-10 text-center">
                            <div className="text-[13px] font-semibold text-[#171717]">
                                Sin grupos creados
                            </div>
                            <p className="mt-1 text-[12px] font-medium text-[#71717a]">
                                Crea grupos para distribuir la inversion por equipos, zonas o usuarios.
                            </p>
                            <IconButton
                                icon="plus"
                                label="Crear grupo"
                                variant="primary"
                                onClick={openCreateGroup}
                                className="mt-4"
                            />
                        </div>
                    )}
                </div>
            </Card>

            <Modal
                open={budgetOpen}
                onClose={() => setBudgetOpen(false)}
                title="Configurar inversion"
                subtitle={`Semana ${weekStartKey} a ${weekEndKey}`}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 rounded-lg border border-[#e5e7eb] bg-[#fafafa] p-3 sm:grid-cols-3">
                        <MiniInvestmentStat label="Presupuesto" value={money(budget)} />
                        <MiniInvestmentStat label="Asignado" value={money(assigned)} />
                        <MiniInvestmentStat
                            label="Restante"
                            value={money(remaining)}
                            tone={Math.abs(remaining) <= 0.01 ? "green" : "red"}
                        />
                    </div>

                    <Field label="Presupuesto total">
                        <Input
                            value={amount}
                            onChange={(e) => setAmount(moneyInput(e.target.value))}
                            placeholder="0.00"
                        />
                    </Field>

                    <div className="flex flex-col-reverse gap-2 border-t border-[#f0f1f2] pt-4 sm:flex-row sm:justify-end">
                        <IconButton
                            icon="x"
                            label="Cancelar"
                            onClick={() => setBudgetOpen(false)}
                            disabled={saving}
                        />
                        <IconButton
                            icon="check"
                            label={saving ? "Guardando" : "Guardar inversion"}
                            variant="primary"
                            onClick={saveBudget}
                            disabled={saving}
                        />
                    </div>
                </div>
            </Modal>

            <Modal
                open={groupOpen}
                onClose={() => {
                    setGroupOpen(false);
                    setGroupDraft(null);
                }}
                title={groupDraft ? groupDraft.name || "Grupo de inversion" : "Grupo de inversion"}
                subtitle="Configura monto, estado y miembros de este grupo."
            >
                <div className="space-y-4">
                    {groupDraft ? (
                        <InvestmentGroupCard
                            index={0}
                            group={groupDraft}
                            users={users}
                            onChange={updateGroupDraft}
                            onToggleUser={toggleDraftUser}
                            onRemove={() => updateGroupDraft({ active: false })}
                        />
                    ) : null}

                    <div className="flex flex-col-reverse gap-2 border-t border-[#f0f1f2] pt-4 sm:flex-row sm:justify-end">
                        <IconButton
                            icon="x"
                            label="Cancelar"
                            onClick={() => {
                                setGroupOpen(false);
                                setGroupDraft(null);
                            }}
                            disabled={saving}
                        />
                        <IconButton
                            icon="check"
                            label={saving ? "Guardando" : "Guardar grupo"}
                            variant="primary"
                            onClick={saveGroup}
                            disabled={saving || !groupDraft}
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function MiniInvestmentStat({
    label,
    value,
    tone = "gray",
}: {
    label: string;
    value: string;
    tone?: "gray" | "green" | "red";
}) {
    return (
        <div>
            <div className="text-[11px] font-semibold text-[#71717a]">{label}</div>
            <div
                className={
                    tone === "green"
                        ? "mt-1 text-[16px] font-semibold text-emerald-600"
                        : tone === "red"
                            ? "mt-1 text-[16px] font-semibold text-red-500"
                            : "mt-1 text-[16px] font-semibold text-[#171717]"
                }
            >
                {value}
            </div>
        </div>
    );
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
            {name === "settings" ? (
                <>
                    <path {...common} d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
                    <path {...common} d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 0 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.08 1.65V21a2.1 2.1 0 0 1-4.2 0v-.07a1.8 1.8 0 0 0-1.08-1.65 1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.18 13H2a2.1 2.1 0 1 1 0-4.2h.07A1.8 1.8 0 0 0 3.72 7.7a1.8 1.8 0 0 0-.36-2l-.05-.05a2.1 2.1 0 1 1 2.97-2.97l.05.05a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 9.4 1.45V1.4a2.1 2.1 0 1 1 4.2 0v.07a1.8 1.8 0 0 0 1.08 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 1 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 20.93 9H21a2.1 2.1 0 1 1 0 4.2h-.07A1.8 1.8 0 0 0 19.4 15Z" />
                </>
            ) : null}
            {name === "edit" ? (
                <>
                    <path {...common} d="M12 20h9" />
                    <path {...common} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                </>
            ) : null}
            {name === "pause" ? <path {...common} d="M8 5v14M16 5v14" /> : null}
            {name === "play" ? <path {...common} d="m8 5 11 7-11 7V5Z" /> : null}
            {name === "x" ? <path {...common} d="M18 6 6 18M6 6l12 12" /> : null}
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

function InvestmentGroupManageCard({
    index,
    group,
    onEdit,
    onToggleActive,
}: {
    index: number;
    group: GroupDraft;
    onEdit: () => void;
    onToggleActive: () => void;
}) {
    return (
        <div className="rounded-lg border border-[#e5e7eb] bg-white p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-[12px] font-semibold text-[#171717]">
                            {group.name || `Grupo ${index + 1}`}
                        </div>
                        <Badge tone={group.active ? "green" : "gray"}>
                            {group.active ? "Activo" : "Inactivo"}
                        </Badge>
                    </div>
                    <div className="mt-1 text-[11px] font-medium text-[#9ca3af]">
                        {money(parseMoney(group.amount))} / semana - {group.userIds.length} usuarios
                    </div>
                </div>

                <div className="flex shrink-0 gap-2">
                    <IconButton
                        icon={group.active ? "pause" : "play"}
                        label={group.active ? "Pausar grupo" : "Activar grupo"}
                        onClick={onToggleActive}
                    />
                    <IconButton
                        icon="edit"
                        label="Editar grupo"
                        variant="primary"
                        onClick={onEdit}
                    />
                </div>
            </div>
        </div>
    );
}

function InvestmentGroupCard({
    index,
    group,
    users,
    onChange,
    onToggleUser,
    onRemove,
}: {
    index: number;
    group: GroupDraft;
    users: UserDoc[];
    onChange: (patch: Partial<GroupDraft>) => void;
    onToggleUser: (userId: string) => void;
    onRemove: () => void;
}) {
    const selectedUsers = users.filter((user) => group.userIds.includes(user.id));
    const availableUsers = users.filter((user) => !group.userIds.includes(user.id));

    return (
        <div className="rounded-lg border border-[#e5e7eb] bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-[#f0f1f2] px-3 py-3">
                <div>
                    <div className="text-[12px] font-semibold text-[#171717]">
                        Grupo {index + 1}
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-[#9ca3af]">
                        {group.userIds.length} usuarios seleccionados
                    </div>
                </div>
                <IconButton
                    icon="pause"
                    label="Pausar grupo"
                    variant="danger"
                    onClick={onRemove}
                />
            </div>

            <div className="space-y-3 p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                    <Field label="Nombre">
                        <Input
                            value={group.name}
                            onChange={(e) => onChange({ name: e.target.value })}
                        />
                    </Field>
                    <Field label="Monto">
                        <Input
                            value={group.amount}
                            onChange={(e) => onChange({ amount: moneyInput(e.target.value) })}
                            placeholder="0.00"
                        />
                    </Field>
                </div>

                <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold text-[#71717a]">
                            Miembros
                        </div>
                        <Badge tone={group.userIds.length ? "blue" : "gray"}>
                            {group.userIds.length} seleccionados
                        </Badge>
                    </div>

                    <select
                        value=""
                        onChange={(event) => {
                            if (event.target.value) onToggleUser(event.target.value);
                        }}
                        disabled={!availableUsers.length}
                        className="h-10 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#171717] outline-none transition focus:border-[#171717] disabled:bg-[#fafafa] disabled:text-[#9ca3af]"
                    >
                        <option value="">
                            {availableUsers.length ? "Agregar usuario al grupo" : "Todos los usuarios ya estan asignados"}
                        </option>
                        {availableUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                                {user.name || user.email || user.id}
                            </option>
                        ))}
                    </select>

                    {selectedUsers.length ? (
                        <details className="mt-2 rounded-lg border border-[#f0f1f2] bg-[#fafafa]">
                            <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-[#52525b]">
                                Ver o quitar miembros
                            </summary>
                            <div className="max-h-40 space-y-1 overflow-y-auto border-t border-[#f0f1f2] p-2">
                                {selectedUsers.map((user) => (
                                    <button
                                        key={user.id}
                                        type="button"
                                        onClick={() => onToggleUser(user.id)}
                                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-[12px] font-semibold text-[#52525b] hover:bg-white"
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate">
                                                {user.name || user.email || user.id}
                                            </span>
                                            <span className="block truncate text-[10px] font-medium text-[#9ca3af]">
                                                {user.billingMode === "weekly_subscription" ? "Suscripcion" : "Por visita"}
                                            </span>
                                        </span>
                                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-500 hover:bg-red-50">
                                            <Icon name="x" />
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </details>
                    ) : (
                        <div className="mt-2 rounded-lg border border-dashed border-[#d4d4d8] bg-[#fafafa] px-3 py-3 text-[12px] font-semibold text-[#9ca3af]">
                            Ningun miembro asignado.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function DashboardContent({
    summary,
    investment,
}: {
    summary: AccountingSummary;
    investment: WeeklyInvestmentDoc | null;
}) {
    const maxReal = Math.max(
        1,
        ...summary.rows.map((row) => Math.abs(Number(row.real) || 0))
    );

    return (
        <div className="space-y-4">
            <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
                <Card>
                    <CardHeader
                        title="Resultado semanal"
                        subtitle="Ganancia generada por visitas y suscripciones."
                    />

                    <div className="border-t border-[#f0f1f2] p-5">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <Metric label="Ganancia bruta" value={money(summary.gross)} delta="+ semana" tone="green" />
                            <Metric
                                label="Inversión"
                                value={money(summary.investment)}
                                delta={investment ? "presupuesto guardado" : "sin inversión"}
                                tone="neutral"
                            />
                            <Metric
                                label="Ganancia real"
                                value={money(summary.real)}
                                delta={`ROI ${formatPercent(summary.roi)}`}
                                tone={summary.real >= 0 ? "green" : "red"}
                            />
                        </div>

                        <div className="mt-8 h-[210px]">
                            <div className="flex h-full items-end gap-3 border-b border-l border-[#eef0f2] px-3 pb-0">
                                {summary.rows.slice(0, 8).map((row) => {
                                    const pct = Math.max(
                                        8,
                                        Math.min(100, (Math.abs(Number(row.real) || 0) / maxReal) * 100)
                                    );

                                    return (
                                        <div key={row.userId} className="flex flex-1 flex-col items-center justify-end gap-2">
                                            <div
                                                className={row.real >= 0 ? "w-full rounded-t-md bg-[#3b82f6]" : "w-full rounded-t-md bg-[#ef4444]"}
                                                style={{ height: `${pct}%` }}
                                            />
                                            <span className="max-w-[70px] truncate text-[10px] font-medium text-[#9ca3af]">
                                                {row.name}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] font-medium text-[#71717a]">
                            <Legend color="blue" label="Resultado positivo" />
                            <Legend color="red" label="Resultado negativo" />
                            <Legend color="gray" label="Top usuarios" />
                        </div>
                    </div>
                </Card>

                <Card>
                    <CardHeader title="Ranking por usuario" subtitle="Ordenado por ganancia real." action={<Button>Expand</Button>} />

                    <div className="border-t border-[#f0f1f2]">
                        <div className="grid grid-cols-[42px_1fr_90px] px-4 py-3 text-[11px] font-medium text-[#9ca3af]">
                            <span>#</span>
                            <span>Usuario</span>
                            <span className="text-right">Real</span>
                        </div>

                        {summary.rows.slice(0, 7).map((row, index) => (
                            <div key={row.userId} className="grid grid-cols-[42px_1fr_90px] items-center border-t border-[#f0f1f2] px-4 py-3">
                                <span className="text-[12px] font-medium text-[#9ca3af]">{index + 1}.</span>

                                <div className="min-w-0">
                                    <div className="truncate text-[12px] font-semibold text-[#171717]">{row.name}</div>
                                    <div className="truncate text-[11px] font-medium text-[#9ca3af]">
                                        {row.billingMode === "weekly_subscription" ? "Suscripción" : "Por visita"}
                                    </div>
                                </div>

                                <div className={row.real >= 0 ? "text-right text-[12px] font-semibold text-emerald-600" : "text-right text-[12px] font-semibold text-red-500"}>
                                    {money(row.real)}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Visitados" value={String(summary.visited)} caption="Clientes visitados" />
                <StatCard label="Rechazados" value={String(summary.rejected)} caption="Clientes rechazados" />
                <StatCard label="Ventas por visita" value={money(summaryNumber(summary, "grossVisits"))} caption="Modelo por visita" />
                <StatCard
                    label="Suscripciones"
                    value={money(summaryNumber(summary, "grossSubscriptions"))}
                    caption={`${summaryNumber(summary, "subscriptionsPaid")} pagadas`}
                />
            </section>

            <Card className="overflow-hidden">
                <CardHeader
                    title="Detalle por usuario"
                    subtitle="Separando modelo por visita y suscripción semanal."
                    action={<Button>Chart Config</Button>}
                />

                <div className="overflow-x-auto border-t border-[#f0f1f2]">
                    <table className="w-full min-w-[920px] border-collapse">
                        <thead>
                            <tr className="border-b border-[#f0f1f2] text-left text-[11px] font-medium text-[#9ca3af]">
                                <th className="px-4 py-3">Usuario</th>
                                <th className="px-4 py-3">Modelo</th>
                                <th className="px-4 py-3">Visitados</th>
                                <th className="px-4 py-3">Rechazados</th>
                                <th className="px-4 py-3 text-right">Bruta</th>
                                <th className="px-4 py-3 text-right">Costo</th>
                                <th className="px-4 py-3 text-right">Real</th>
                            </tr>
                        </thead>

                        <tbody>
                            {summary.rows.map((row) => (
                                <tr key={row.userId} className="border-b border-[#f0f1f2] last:border-0 hover:bg-[#fafafa]">
                                    <td className="px-4 py-3">
                                        <div className="text-[12px] font-semibold text-[#171717]">{row.name}</div>
                                        <div className="mt-0.5 text-[11px] font-medium text-[#9ca3af]">{row.email || row.userId}</div>
                                    </td>

                                    <td className="px-4 py-3">
                                        <ModelBadge mode={row.billingMode} paid={row.subscriptionPaid} />
                                    </td>

                                    <td className="px-4 py-3">
                                        <Badge tone="green">{row.visited}</Badge>
                                    </td>

                                    <td className="px-4 py-3">
                                        <Badge tone="red">{row.rejected}</Badge>
                                    </td>

                                    <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#171717]">{money(row.gross)}</td>
                                    <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#71717a]">{money(row.cost)}</td>
                                    <td className={row.real >= 0 ? "px-4 py-3 text-right text-[12px] font-semibold text-emerald-600" : "px-4 py-3 text-right text-[12px] font-semibold text-red-500"}>
                                        {money(row.real)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}

function ScreenShell({ children }: { children: React.ReactNode }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[#f4f5f6] p-5 text-[#171717]">
            {typeof children === "string" ? (
                <p className="text-[13px] font-medium text-[#71717a]">{children}</p>
            ) : (
                children
            )}
        </main>
    );
}

function Metric({
    label,
    value,
    delta,
    tone,
}: {
    label: string;
    value: string;
    delta: string;
    tone: "green" | "red" | "neutral";
}) {
    return (
        <div>
            <div className="flex items-center gap-1 text-[12px] font-medium text-[#71717a]">
                {label}
                <span className="text-[#c4c4c4]">ⓘ</span>
            </div>

            <div className="mt-2 flex items-end gap-2">
                <span className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-[#171717]">
                    {value}
                </span>
            </div>

            <div
                className={
                    tone === "green"
                        ? "mt-1 text-[12px] font-semibold text-emerald-600"
                        : tone === "red"
                            ? "mt-1 text-[12px] font-semibold text-red-500"
                            : "mt-1 text-[12px] font-semibold text-[#9ca3af]"
                }
            >
                {delta}
            </div>
        </div>
    );
}

function Legend({
    color,
    label,
}: {
    color: "blue" | "red" | "gray";
    label: string;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span
                className={
                    color === "blue"
                        ? "h-2 w-2 rounded-full bg-[#3b82f6]"
                        : color === "red"
                            ? "h-2 w-2 rounded-full bg-[#ef4444]"
                            : "h-2 w-2 rounded-full bg-[#d1d5db]"
                }
            />
            {label}
        </span>
    );
}

function ModelBadge({
    mode,
    paid,
}: {
    mode: "per_visit" | "weekly_subscription";
    paid?: boolean;
}) {
    if (mode === "weekly_subscription") {
        return (
            <Badge tone={paid ? "blue" : "gray"}>
                {paid ? "Suscripción pagada" : "Suscripción no pagada"}
            </Badge>
        );
    }

    return <Badge tone="purple">Por visita</Badge>;
}

function parseMoney(value: string) {
    const clean = String(value ?? "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    const normalized = parts.length <= 2 ? clean : `${parts[0]}.${parts.slice(1).join("")}`;
    const n = Number(normalized);
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function moneyInput(value: string) {
    const clean = String(value ?? "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");
    const parts = clean.split(".");
    return parts.length <= 2 ? clean : `${parts[0]}.${parts.slice(1).join("")}`;
}

function makeGroupId() {
    return `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function upsertDraft(groups: GroupDraft[], next: GroupDraft) {
    const exists = groups.some((group) => group.id === next.id);
    return exists
        ? groups.map((group) => (group.id === next.id ? next : group))
        : [...groups, next];
}

function upsertCatalogGroup(groups: InvestmentGroupDoc[], next: InvestmentGroupDoc) {
    const exists = groups.some((group) => group.id === next.id);
    return exists
        ? groups.map((group) => (group.id === next.id ? next : group))
        : [next, ...groups];
}

function groupsToDrafts(groups?: WeeklyInvestmentGroup[]) {
    return Array.isArray(groups)
        ? groups.map((group, index) => ({
            id: group.id || `group_${index + 1}`,
            name: group.name || `Grupo ${index + 1}`,
            amount: group.amount > 0 ? String(group.amount) : "",
            userIds: Array.isArray(group.userIds) ? group.userIds : [],
            active: group.status !== "inactive",
        }))
        : [];
}

function catalogGroupsToDrafts(groups: InvestmentGroupDoc[]) {
    return groups.map((group, index) => ({
        id: group.id || `group_${index + 1}`,
        name: group.name || `Grupo ${index + 1}`,
        amount: group.defaultAmount > 0 ? String(group.defaultAmount) : "",
        userIds: Array.isArray(group.userIds) ? group.userIds : [],
        active: group.status !== "inactive",
    }));
}

function draftToGroups(drafts: GroupDraft[]): WeeklyInvestmentGroup[] {
    return drafts
        .map((draft, index) => ({
            id: draft.id || `group_${index + 1}`,
            groupId: draft.id || `group_${index + 1}`,
            name: draft.name.trim() || `Grupo ${index + 1}`,
            amount: parseMoney(draft.amount),
            userIds: Array.from(new Set(draft.userIds.filter(Boolean))),
            status: draft.active ? "active" as const : "inactive" as const,
        }))
        .filter((group) => group.status === "active" && group.amount > 0 && group.userIds.length > 0);
}
