"use client";

import { useEffect, useMemo, useState } from "react";
import { weekRangeKeysMonToSun, addDays, money } from "@/lib/date";
import {
    closeWeeklyInvestment,
    deleteInvestmentGroup,
    getWeeklyInvestment,
    listClientAssignmentsByRange,
    listInvestmentGroups,
    listAccountingUsers,
    listDailyEventsByRange,
    reopenWeeklyInvestment,
    updateWeeklySubscriptionPayment,
    upsertInvestmentGroup,
    upsertWeeklyInvestment,
} from "@/data/accountingRepo";
import { buildAccountingSummary } from "@/features/accounting/calcAccounting";
import { useAuth } from "@/features/auth/AuthProvider";
import type {
    AccountingSummary,
    AccountingAssignmentDoc,
    DailyEventDoc,
    InvestmentGroupDoc,
    UserDoc,
    WeeklyInvestmentDoc,
    WeeklyInvestmentGroup,
} from "@/types/accounting";
import {
    AppIcon,
    Badge,
    Button,
    Card,
    CardHeader,
    Field,
    IconButton,
    Input,
    KpiCard,
    Modal,
    PageHeader,
} from "@/components/ui";

type AccountingTab = "overview" | "investment";
type AccountingMetric = "real" | "gross" | "visited" | "rejected" | "assigned" | "cost";
type ChartMode = "trend" | "bars" | "mix" | "share";
type ChartPoint = {
    dayKey: string;
    label: string;
    value: number;
};
type IconName =
    | "activity"
    | "arrowLeft"
    | "arrowRight"
    | "calendar"
    | "check"
    | "download"
    | "edit"
    | "lock"
    | "pause"
    | "play"
    | "plus"
    | "refresh"
    | "settings"
    | "trash"
    | "moreHorizontal"
    | "unlock"
    | "users"
    | "x";
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
    if (value == null || !Number.isFinite(value)) return "-";
    return `${value.toFixed(1)}%`;
}

function formatDateTime(ms?: number | null) {
    if (!ms) return "Sin fecha";
    return new Intl.DateTimeFormat("es", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(ms));
}

function summaryNumber(summary: AccountingSummary, key: keyof AccountingSummary) {
    const value = summary[key];
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function safeNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function subscriptionAmount(user: UserDoc) {
    return safeNumber(user.weeklySubscriptionAmount, 0);
}

function subscriptionCost(user: UserDoc) {
    return safeNumber(user.weeklySubscriptionCost, 0);
}

function subscriptionCaption(user: UserDoc) {
    if (user.billingMode !== "weekly_subscription") return "Por visita";
    return `Suscripcion - cuota ${money(subscriptionAmount(user))} / costo ${money(subscriptionCost(user))}`;
}

function differs(a: number | null | undefined, b: number | null | undefined) {
    if (a == null && b == null) return false;
    return Math.abs(Number(a ?? 0) - Number(b ?? 0)) > 0.01;
}

function snapshotDiffers(summary: AccountingSummary, finalSummary: NonNullable<WeeklyInvestmentDoc["finalSummary"]>) {
    return (
        differs(summary.gross, finalSummary.gross)
        || differs(summary.investment, finalSummary.investment)
        || differs(summary.real, finalSummary.real)
        || differs(summary.roi, finalSummary.roi)
        || summary.assigned !== (finalSummary.assigned ?? 0)
        || summary.visited !== finalSummary.visited
        || summary.rejected !== finalSummary.rejected
        || summary.subscriptionsPaid !== finalSummary.subscriptionsPaid
        || summary.rows.length !== finalSummary.rowsCount
    );
}

function excelText(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function excelMoney(value: number) {
    return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function exportAccountingSheet(summary: AccountingSummary) {
    const rows = summary.rows
        .map((row) => {
            const model = row.billingMode === "weekly_subscription" ? "Suscripcion" : "Por visita";
            const payment = row.billingMode === "weekly_subscription"
                ? row.subscriptionPaid
                    ? "Pagada"
                    : "Pendiente"
                : "";

            return `
                <tr>
                    <td class="text">${excelText(row.name)}</td>
                    <td class="text">${excelText(row.email || row.userId)}</td>
                    <td class="text">${model}</td>
                    <td class="num">${row.assigned}</td>
                    <td class="num">${row.visited}</td>
                    <td class="num">${row.rejected}</td>
                    <td class="money">${excelMoney(row.gross)}</td>
                    <td class="money">${excelMoney(row.cost)}</td>
                    <td class="money ${row.real >= 0 ? "positive" : "negative"}">${excelMoney(row.real)}</td>
                    <td class="text">${payment}</td>
                </tr>
            `;
        })
        .join("");

    const html = `
        <html>
            <head>
                <meta charset="utf-8" />
                <style>
                    body { font-family: Arial, sans-serif; color: #172033; }
                    table { border-collapse: collapse; table-layout: fixed; width: 1180px; }
                    th { background: #f2f4f7; color: #344054; font-weight: 700; }
                    th, td { border: 1px solid #d0d5dd; padding: 8px 10px; font-size: 12px; vertical-align: middle; }
                    .title { font-size: 18px; font-weight: 700; background: #ffffff; border: 0; padding: 4px 0 12px; }
                    .section { background: #eaf2ff; font-weight: 700; }
                    .label { background: #f9fafb; font-weight: 700; width: 220px; }
                    .text { mso-number-format: "\\@"; text-align: left; }
                    .num { text-align: right; width: 95px; }
                    .money { text-align: right; width: 120px; mso-number-format: "0.00"; }
                    .positive { color: #047857; font-weight: 700; }
                    .negative { color: #dc2626; font-weight: 700; }
                    .w-user { width: 190px; }
                    .w-id { width: 240px; }
                    .w-model { width: 130px; }
                    .w-pay { width: 130px; }
                </style>
            </head>
            <body>
                <table>
                    <tr><td class="title" colspan="10">TrackGo - Contabilidad semanal</td></tr>
                    <tr><td class="label">Semana</td><td colspan="9">${summary.startKey} a ${summary.endKey}</td></tr>
                    <tr><td class="section" colspan="10">Resumen</td></tr>
                    <tr>
                        <td class="label">Asignados</td><td class="num">${summary.assigned}</td>
                        <td class="label">Visitados</td><td class="num">${summary.visited}</td>
                        <td class="label">Rechazados</td><td class="num">${summary.rejected}</td>
                        <td class="label">Suscripciones pagadas</td><td class="num">${summary.subscriptionsPaid}</td>
                    </tr>
                    <tr>
                        <td class="label">Ganancia bruta</td><td class="money">${excelMoney(summary.gross)}</td>
                        <td class="label">Inversion</td><td class="money">${excelMoney(summary.investment)}</td>
                        <td class="label">Ganancia real</td><td class="money ${summary.real >= 0 ? "positive" : "negative"}">${excelMoney(summary.real)}</td>
                        <td class="label">ROI</td><td class="num">${summary.roi == null ? "" : summary.roi.toFixed(2) + "%"}</td>
                        <td class="label">Ajuste manual</td><td class="money">${excelMoney(summary.manualAdjustment)}</td>
                    </tr>
                    <tr>
                        <td class="label">Ventas por visita</td><td class="money">${excelMoney(summary.grossVisits)}</td>
                        <td class="label">Suscripciones</td><td class="money">${excelMoney(summary.grossSubscriptions)}</td>
                        <td class="label">Inversion suscripciones</td><td class="money">${excelMoney(summary.subscriptionInvestment)}</td>
                        <td class="label">Inversion grupos</td><td class="money" colspan="3">${excelMoney(summary.groupInvestment)}</td>
                    </tr>
                    <tr><td class="section" colspan="10">Detalle por usuario</td></tr>
                    <tr>
                        <th class="w-user">Usuario</th>
                        <th class="w-id">Email / ID</th>
                        <th class="w-model">Modelo</th>
                        <th>Asignados</th>
                        <th>Visitados</th>
                        <th>Rechazados</th>
                        <th>Bruta</th>
                        <th>Costo</th>
                        <th>Real</th>
                        <th class="w-pay">Pago suscripcion</th>
                    </tr>
                    ${rows}
                </table>
            </body>
        </html>
    `;

    const blob = new Blob([html], {
        type: "application/vnd.ms-excel;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trackgo-contabilidad-${summary.startKey}-a-${summary.endKey}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export default function AccountingPage() {
    const { firebaseUser } = useAuth();
    const [activeTab, setActiveTab] = useState<AccountingTab>("overview");
    const [weekOffset, setWeekOffset] = useState(0);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [assignments, setAssignments] = useState<AccountingAssignmentDoc[]>([]);
    const [investment, setInvestment] = useState<WeeklyInvestmentDoc | null>(null);
    const [investmentGroups, setInvestmentGroups] = useState<InvestmentGroupDoc[]>([]);
    const [closeOpen, setCloseOpen] = useState(false);
    const [reopenOpen, setReopenOpen] = useState(false);

    const [loading, setLoading] = useState(true);
    const [savingWeek, setSavingWeek] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const week = useMemo(() => {
        return weekRangeKeysMonToSun(shiftWeek(new Date(), weekOffset));
    }, [weekOffset]);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setErr(null);

            try {
                const endOfWeek = new Date(week.endDate);
                endOfWeek.setHours(23, 59, 59, 999);

                const [u, ev, ass, inv, groupCatalog] = await Promise.all([
                    listAccountingUsers(),
                    listDailyEventsByRange(week.startKey, week.endKey),
                    listClientAssignmentsByRange({
                        startKey: week.startKey,
                        endKey: week.endKey,
                        startMs: week.startDate.getTime(),
                        endMs: endOfWeek.getTime(),
                    }),
                    getWeeklyInvestment(week.startKey),
                    listInvestmentGroups(),
                ]);

                if (cancelled) return;

                let weeklyInvestment = inv;
                if (!weeklyInvestment && weekOffset === 0 && groupCatalog.length) {
                    const seedGroups = draftToGroups(catalogGroupsToDrafts(groupCatalog));
                    if (seedGroups.length) {
                        weeklyInvestment = await upsertWeeklyInvestment({
                            weekStartKey: week.startKey,
                            weekEndKey: week.endKey,
                            amount: 0,
                            groups: seedGroups,
                        });
                    }
                }

                if (cancelled) return;

                setUsers(u);
                setEvents(ev);
                setAssignments(ass);
                setInvestment(weeklyInvestment);
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
    }, [week.startKey, week.endKey, week.startDate, week.endDate, weekOffset, refreshNonce]);

    const summary: AccountingSummary | null = useMemo(() => {
        return buildAccountingSummary({
            startKey: week.startKey,
            endKey: week.endKey,
            users,
            events,
            assignments,
            investment,
        });
    }, [week.startKey, week.endKey, users, events, assignments, investment]);

    const weekStatus = investment?.status ?? "draft";
    const isClosed = weekStatus === "closed";

    async function toggleSubscriptionPayment(row: AccountingSummary["rows"][number]) {
        if (isClosed) {
            setErr("La semana esta cerrada. Reabre la semana para editar pagos.");
            return;
        }

        const user = users.find((item) => item.id === row.userId);
        if (!user || row.billingMode !== "weekly_subscription") return;

        const nextPaid = row.subscriptionPaid !== true;
        const amount = user.weeklySubscriptionWeeks?.[week.startKey]?.amount
            ?? user.weeklySubscriptionAmount
            ?? 0;
        const cost = user.weeklySubscriptionWeeks?.[week.startKey]?.cost
            ?? user.weeklySubscriptionCost
            ?? 0;

        setErr(null);

        try {
            await updateWeeklySubscriptionPayment({
                userId: row.userId,
                weekStartKey: week.startKey,
                paid: nextPaid,
                amount,
                cost,
                updatedBy: firebaseUser?.uid ?? null,
            });

            setUsers((prev) =>
                prev.map((item) =>
                    item.id === row.userId
                        ? {
                            ...item,
                            weeklySubscriptionWeeks: {
                                ...(item.weeklySubscriptionWeeks ?? {}),
                                [week.startKey]: {
                                    paid: nextPaid,
                                    amount,
                                    cost,
                                    updatedAt: Date.now(),
                                    updatedBy: firebaseUser?.uid ?? null,
                                },
                            },
                        }
                        : item
                )
            );
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo actualizar la suscripcion.");
        }
    }

    async function handleCloseWeek() {
        if (!summary) return;

        setErr(null);
        setSavingWeek(true);

        try {
            const next = await closeWeeklyInvestment({
                weekStartKey: week.startKey,
                weekEndKey: week.endKey,
                summary,
                closedBy: firebaseUser?.uid ?? null,
            });
            setInvestment(next);
            setCloseOpen(false);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cerrar la semana.");
        } finally {
            setSavingWeek(false);
        }
    }

    async function handleReopenWeek() {
        setErr(null);
        setSavingWeek(true);

        try {
            const next = await reopenWeeklyInvestment({
                weekStartKey: week.startKey,
                reopenedBy: firebaseUser?.uid ?? null,
            });
            setInvestment(next);
            setReopenOpen(false);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo reabrir la semana.");
        } finally {
            setSavingWeek(false);
        }
    }

    return (
        <div className="mx-auto w-full max-w-[1220px]">
            <PageHeader
                title="Contabilidad"
                subtitle="Control semanal de ingresos, inversion, suscripciones y resultado real."
                icon={<AppIcon name="activity" tone="green" size="sm" className="bg-transparent text-white ring-0" />}
                actions={
                    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                        <div className="grid grid-cols-5 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                            {activeTab === "investment" ? (
                                <IconButton
                                    icon="activity"
                                    label="Ver resumen"
                                    variant="primary"
                                    onClick={() => setActiveTab("overview")}
                                />
                            ) : null}
                            {summary ? (
                                <IconButton
                                    icon="download"
                                    label="Exportar Excel"
                                    variant="primary"
                                    onClick={() => exportAccountingSheet(summary)}
                                />
                            ) : null}
                            <IconButton
                                icon="wallet"
                                label="Configurar inversion"
                                variant="primary"
                                onClick={() => setActiveTab("investment")}
                            />
                            {isClosed ? (
                                <IconButton
                                    icon="unlock"
                                    label="Reabrir semana"
                                    onClick={() => setReopenOpen(true)}
                                    disabled={savingWeek || !investment}
                                />
                            ) : (
                                <IconButton
                                    icon="lock"
                                    label="Cerrar semana"
                                    variant="primary"
                                    onClick={() => setCloseOpen(true)}
                                    disabled={savingWeek || !summary}
                                />
                            )}
                            <IconButton
                                icon="refresh"
                                label="Actualizar"
                                variant="primary"
                                onClick={() => setRefreshNonce((value) => value + 1)}
                                disabled={loading}
                            />
                        </div>
                        <StatusPill status={weekStatus} />
                    </div>
                }
            />

            <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#e4e7ec] bg-white px-3 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div className="grid grid-cols-[40px_1fr_40px] items-center gap-2 sm:flex sm:flex-wrap">
                    <IconButton
                        icon="arrowLeft"
                        label="Semana anterior"
                        onClick={() => setWeekOffset((v) => v - 1)}
                    />
                    <div className="flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl border border-[#e4e7ec] bg-[#f9fafb] px-2 text-[11px] font-bold text-[#344054] sm:h-9 sm:justify-start sm:rounded-md sm:px-3 sm:text-[12px]">
                        <Icon name="calendar" />
                        <span className="truncate">{week.startKey}</span>
                        <span className="text-[#98a2b3]">/</span>
                        <span className="truncate">{week.endKey}</span>
                    </div>
                    <IconButton
                        icon="arrowRight"
                        label="Semana siguiente"
                        onClick={() => setWeekOffset((v) => v + 1)}
                    />
                    {weekOffset !== 0 ? (
                        <Button onClick={() => setWeekOffset(0)} className="col-span-3 sm:col-span-1">
                            Actual
                        </Button>
                    ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    <CounterPill icon="users" label={`${users.length} usuarios`} />
                    <CounterPill icon="activity" label={`${events.length} eventos`} />
                </div>
            </section>

            {err ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">
                    {err}
                </div>
            ) : null}

            {loading || !summary ? (
                <Card className="p-6 text-[13px] font-medium text-[#667085]">
                    Cargando contabilidad...
                </Card>
            ) : (
                <div className="space-y-4">
                    {isClosed && investment?.finalSummary ? (
                        <ClosedWeekPanel
                            summary={summary}
                            finalSummary={investment.finalSummary}
                        />
                    ) : null}

                    {activeTab === "overview" ? (
                        <DashboardContent
                            summary={summary}
                            events={events}
                            assignments={assignments}
                            startDate={week.startDate}
                            endDate={week.endDate}
                            isClosed={isClosed}
                            onToggleSubscriptionPayment={toggleSubscriptionPayment}
                        />
                    ) : (
                        <InvestmentContent
                            weekStartKey={week.startKey}
                            weekEndKey={week.endKey}
                            users={users}
                            investment={investment}
                            investmentGroups={investmentGroups}
                            useCatalogDefaults={weekOffset === 0}
                            isClosed={isClosed}
                            onSaved={(next) => {
                                setInvestment(next);
                            }}
                            onGroupsSaved={setInvestmentGroups}
                            onError={setErr}
                        />
                    )}
                </div>
            )}

            <Modal
                open={closeOpen}
                onClose={() => setCloseOpen(false)}
                title="Cerrar semana"
                subtitle={`${week.startKey} a ${week.endKey}`}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 rounded-lg border border-[#e4e7ec] bg-[#f9fafb] p-3 sm:grid-cols-3">
                        <MiniInvestmentStat label="Bruta" value={money(summary?.gross ?? 0)} />
                        <MiniInvestmentStat label="Inversion" value={money(summary?.investment ?? 0)} />
                        <MiniInvestmentStat label="Real" value={money(summary?.real ?? 0)} />
                    </div>

                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
                        Al cerrar la semana se guarda un snapshot final y se bloquean pagos, grupos y ajustes hasta reabrirla.
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:justify-end">
                        <IconButton
                            icon="close"
                            label="Cancelar"
                            onClick={() => setCloseOpen(false)}
                            disabled={savingWeek}
                        />
                        <IconButton
                            icon="lock"
                            label={savingWeek ? "Cerrando" : "Cerrar semana"}
                            variant="primary"
                            onClick={handleCloseWeek}
                            disabled={savingWeek || !summary}
                        />
                    </div>
                </div>
            </Modal>

            <Modal
                open={reopenOpen}
                onClose={() => setReopenOpen(false)}
                title="Reabrir semana"
                subtitle={`${week.startKey} a ${week.endKey}`}
            >
                <div className="space-y-4">
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">
                        Reabrir permite modificar una semana ya cerrada. El snapshot final anterior queda guardado como referencia.
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:justify-end">
                        <IconButton
                            icon="close"
                            label="Cancelar"
                            onClick={() => setReopenOpen(false)}
                            disabled={savingWeek}
                        />
                        <IconButton
                            icon="unlock"
                            label={savingWeek ? "Reabriendo" : "Reabrir semana"}
                            variant="danger"
                            onClick={handleReopenWeek}
                            disabled={savingWeek || !investment}
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function InvestmentContent({
    weekStartKey,
    weekEndKey,
    users,
    investment,
    investmentGroups,
    useCatalogDefaults,
    isClosed,
    onSaved,
    onGroupsSaved,
    onError,
}: {
    weekStartKey: string;
    weekEndKey: string;
    users: UserDoc[];
    investment: WeeklyInvestmentDoc | null;
    investmentGroups: InvestmentGroupDoc[];
    useCatalogDefaults: boolean;
    isClosed: boolean;
    onSaved: (investment: WeeklyInvestmentDoc) => void;
    onGroupsSaved: (groups: InvestmentGroupDoc[]) => void;
    onError: (message: string | null) => void;
}) {
    const [amount, setAmount] = useState("0");
    const [groups, setGroups] = useState<GroupDraft[]>([]);
    const [budgetOpen, setBudgetOpen] = useState(false);
    const [groupOpen, setGroupOpen] = useState(false);
    const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
    const [deleteDraft, setDeleteDraft] = useState<GroupDraft | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        queueMicrotask(() => {
            const hasWeeklySnapshot = investment !== null;
            const drafts = hasWeeklySnapshot
                ? groupsToDrafts(investment.groups)
                : useCatalogDefaults
                    ? catalogGroupsToDrafts(investmentGroups)
                    : [];
            setAmount(String(investment?.amount || 0));
            setGroups(drafts);
        });
    }, [investment, investmentGroups, useCatalogDefaults, weekStartKey]);

    const validGroups = useMemo(() => draftToGroups(groups), [groups]);
    const activeGroups = useMemo(
        () => validGroups.filter((group) => group.status !== "inactive"),
        [validGroups]
    );
    const manualAdjustment = useMemo(() => parseMoney(amount), [amount]);
    const assigned = useMemo(
        () => activeGroups.reduce((sum, group) => sum + group.amount, 0),
        [activeGroups]
    );
    const subscriptionRows = useMemo(
        () => users.filter((user) => user.billingMode === "weekly_subscription"),
        [users]
    );
    const paidSubscriptionRows = useMemo(
        () =>
            subscriptionRows.filter(
                (user) => user.weeklySubscriptionWeeks?.[weekStartKey]?.paid === true
            ),
        [subscriptionRows, weekStartKey]
    );
    const subscriptionInvestment = paidSubscriptionRows.reduce(
        (sum, user) =>
            sum + safeNumber(
                user.weeklySubscriptionWeeks?.[weekStartKey]?.cost,
                subscriptionCost(user)
            ),
        0
    );
    const totalInvestment = Math.round((subscriptionInvestment + assigned + manualAdjustment) * 100) / 100;
    const assignedPct = totalInvestment > 0 ? Math.min(100, Math.round((assigned / totalInvestment) * 100)) : 0;

    function openCreateGroup() {
        if (isClosed) {
            onError("La semana esta cerrada. Reabre la semana para crear grupos.");
            return;
        }

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
        if (isClosed) {
            onError("La semana esta cerrada. Reabre la semana para editar grupos.");
            return;
        }

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

        if (isClosed) {
            onError("La semana esta cerrada. Reabre la semana para editar la inversion.");
            return;
        }

        if (manualAdjustment < 0) {
            onError("El ajuste manual no puede ser negativo.");
            return;
        }

        setSaving(true);

        try {
            const next = await upsertWeeklyInvestment({
                weekStartKey,
                weekEndKey,
                amount: manualAdjustment,
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

        if (isClosed) {
            onError("La semana esta cerrada. Reabre la semana para editar grupos.");
            return;
        }

        setSaving(true);

        try {
            const savedGroup = useCatalogDefaults
                ? await upsertInvestmentGroup({
                    id: groupDraft.id,
                    name: groupDraft.name,
                    defaultAmount: parseMoney(groupDraft.amount),
                    userIds: groupDraft.userIds,
                    status: groupDraft.active ? "active" : "inactive",
                })
                : null;
            const nextGroups = upsertDraft(groups, groupDraft);
            const nextInvestment = await upsertWeeklyInvestment({
                weekStartKey,
                weekEndKey,
                amount: manualAdjustment,
                groups: draftToGroups(nextGroups),
            });

            setGroups(nextGroups);
            if (savedGroup) {
                onGroupsSaved(upsertCatalogGroup(investmentGroups, savedGroup));
            }
            onSaved(nextInvestment);
            setGroupOpen(false);
            setGroupDraft(null);
        } catch (error) {
            onError(error instanceof Error ? error.message : "No se pudo guardar el grupo.");
        } finally {
            setSaving(false);
        }
    }

    async function confirmDeleteGroup() {
        if (!deleteDraft) return;

        onError(null);

        if (isClosed) {
            onError("La semana esta cerrada. Reabre la semana para eliminar grupos.");
            return;
        }

        setSaving(true);

        try {
            const nextGroups = groups.filter((group) => group.id !== deleteDraft.id);
            if (useCatalogDefaults) {
                await deleteInvestmentGroup(deleteDraft.id);
            }
            const nextInvestment = await upsertWeeklyInvestment({
                weekStartKey,
                weekEndKey,
                amount: manualAdjustment,
                groups: draftToGroups(nextGroups),
            });

            setGroups(nextGroups);
            if (useCatalogDefaults) {
                onGroupsSaved(investmentGroups.filter((group) => group.id !== deleteDraft.id));
            }
            onSaved(nextInvestment);
            setDeleteDraft(null);
        } catch (error) {
            onError(error instanceof Error ? error.message : "No se pudo eliminar el grupo.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-4">
            <section className="grid gap-4 md:grid-cols-3">
                <KpiCard label="Inversion total" value={money(totalInvestment)} caption={`${weekStartKey} a ${weekEndKey}`} icon="activity" tone="green" />
                <KpiCard label="Suscripciones" value={money(subscriptionInvestment)} caption={`${paidSubscriptionRows.length} pagadas`} icon="users" tone="purple" />
                <KpiCard label="Grupos activos" value={money(assigned)} caption={`${activeGroups.length} activos / ${validGroups.length} guardados`} icon="assign" tone="purple" />
            </section>

            <Card className="overflow-hidden">
                <CardHeader
                    title="Inversion semanal"
                    subtitle={isClosed ? "Semana cerrada. Reabre para modificar inversion, grupos o pagos." : "Total calculado por suscripciones pagadas, grupos activos y ajustes manuales."}
                    action={
                        <IconButton
                            icon="settings"
                            label="Configurar ajuste"
                            variant="primary"
                            onClick={() => setBudgetOpen(true)}
                            disabled={isClosed}
                        />
                    }
                />

                <div className="grid gap-4 border-t border-[#eef1f5] p-4 md:grid-cols-3">
                    <MiniInvestmentStat label="Suscripciones" value={money(subscriptionInvestment)} />
                    <MiniInvestmentStat label="Grupos activos" value={money(assigned)} />
                    <MiniInvestmentStat label="Ajuste manual" value={money(manualAdjustment)} />
                </div>
                <div className="border-t border-[#eef1f5] px-4 py-4">
                    <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[#667085]">
                        <span>Participacion de grupos en la inversion</span>
                        <span>{assignedPct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#eef1f5]">
                        <div
                            className="h-full rounded-full bg-[#7c3aed]"
                            style={{ width: `${assignedPct}%` }}
                        />
                    </div>
                </div>
            </Card>

            <Card className="overflow-hidden">
                <CardHeader
                    title="Suscripciones"
                    subtitle="Usuarios con modelo semanal. Solo las pagadas cuentan en inversion e ingresos."
                />

                <div className="border-t border-[#eef1f5] p-4">
                    {subscriptionRows.length ? (
                        <div className="grid gap-2 xl:grid-cols-2">
                            {subscriptionRows.map((user) => {
                                const paid = user.weeklySubscriptionWeeks?.[weekStartKey]?.paid === true;
                                return (
                                    <div
                                        key={user.id}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-[#e4e7ec] bg-white px-3 py-3"
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate text-[12px] font-semibold text-[#172033]">
                                                {user.name || user.email || user.id}
                                            </div>
                                            <div className="mt-0.5 text-[11px] font-medium text-[#667085]">
                                                Cuota {money(subscriptionAmount(user))} / costo {money(subscriptionCost(user))}
                                            </div>
                                        </div>
                                        <Badge tone={paid ? "green" : "yellow"}>
                                            {paid ? "Pagada" : "Pendiente"}
                                        </Badge>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-3 py-6 text-center text-[12px] font-semibold text-[#667085]">
                            No hay usuarios con suscripcion semanal.
                        </div>
                    )}
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
                            disabled={isClosed}
                        />
                    }
                />

                <div className="border-t border-[#eef1f5] p-4">
                    {groups.length ? (
                        <div className="grid gap-3 xl:grid-cols-2">
                            {groups.map((group, index) => (
                                <InvestmentGroupManageCard
                                    key={group.id}
                                    index={index}
                                    group={group}
                                    disabled={isClosed}
                                    onEdit={() => openEditGroup(group)}
                                    onDelete={() => setDeleteDraft(group)}
                                    onToggleActive={async () => {
                                        if (isClosed) {
                                            onError("La semana esta cerrada. Reabre la semana para editar grupos.");
                                            return;
                                        }

                                        const nextGroup = { ...group, active: !group.active };
                                        const nextGroups = upsertDraft(groups, nextGroup);
                                        updateGroupInList(group.id, { active: nextGroup.active });

                                        try {
                                            const savedGroup = useCatalogDefaults
                                                ? await upsertInvestmentGroup({
                                                    id: nextGroup.id,
                                                    name: nextGroup.name,
                                                    defaultAmount: parseMoney(nextGroup.amount),
                                                    userIds: nextGroup.userIds,
                                                    status: nextGroup.active ? "active" : "inactive",
                                                })
                                                : null;
                                            const nextInvestment = await upsertWeeklyInvestment({
                                                weekStartKey,
                                                weekEndKey,
                                                amount: manualAdjustment,
                                                groups: draftToGroups(nextGroups),
                                            });

                                            setGroups(nextGroups);
                                            if (savedGroup) {
                                                onGroupsSaved(upsertCatalogGroup(investmentGroups, savedGroup));
                                            }
                                            onSaved(nextInvestment);
                                        } catch (error) {
                                            updateGroupInList(group.id, { active: group.active });
                                            onError(error instanceof Error ? error.message : "No se pudo actualizar el grupo.");
                                        }
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-[#d0d5dd] bg-white px-4 py-10 text-center">
                            <div className="text-[13px] font-semibold text-[#172033]">
                                Sin grupos creados
                            </div>
                            <p className="mt-1 text-[12px] font-medium text-[#667085]">
                                Crea grupos para distribuir la inversion por equipos, zonas o usuarios.
                            </p>
                            <IconButton
                                icon="plus"
                                label="Crear grupo"
                                variant="primary"
                                onClick={openCreateGroup}
                                disabled={isClosed}
                                className="mt-4"
                            />
                        </div>
                    )}
                </div>
            </Card>

            <Modal
                open={budgetOpen}
                onClose={() => setBudgetOpen(false)}
                title="Ajuste manual"
                subtitle={`Semana ${weekStartKey} a ${weekEndKey}`}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 rounded-lg border border-[#e4e7ec] bg-[#f9fafb] p-3 sm:grid-cols-3">
                        <MiniInvestmentStat label="Suscripciones" value={money(subscriptionInvestment)} />
                        <MiniInvestmentStat label="Grupos" value={money(assigned)} />
                        <MiniInvestmentStat label="Ajuste" value={money(manualAdjustment)} />
                    </div>

                    <Field label="Ajuste manual opcional">
                        <Input
                            value={amount}
                            onChange={(e) => setAmount(moneyInput(e.target.value))}
                            placeholder="0.00"
                        />
                    </Field>

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:justify-end">
                        <IconButton
                            icon="close"
                            label="Cancelar"
                            onClick={() => setBudgetOpen(false)}
                            disabled={saving}
                        />
                        <IconButton
                            icon="check"
                            label={saving ? "Guardando" : "Guardar ajuste"}
                            variant="primary"
                            onClick={saveBudget}
                            disabled={saving || isClosed}
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

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:justify-end">
                        <IconButton
                            icon="close"
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
                            disabled={saving || !groupDraft || isClosed}
                        />
                    </div>
                </div>
            </Modal>

            <Modal
                open={Boolean(deleteDraft)}
                onClose={() => setDeleteDraft(null)}
                title="Eliminar grupo"
                subtitle={deleteDraft ? deleteDraft.name : "Grupo de inversion"}
            >
                <div className="space-y-4">
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">
                        {useCatalogDefaults
                            ? "Este grupo se quitara del catalogo y de la inversion de esta semana. Las semanas anteriores con historial guardado no se modifican."
                            : "Este grupo se quitara solo de esta semana historica. El catalogo actual no se modificara."}
                    </div>

                    {deleteDraft ? (
                        <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
                            <div className="text-[12px] font-semibold text-[#172033]">
                                {deleteDraft.name || "Grupo sin nombre"}
                            </div>
                            <div className="mt-1 text-[11px] font-medium text-[#667085]">
                                {money(parseMoney(deleteDraft.amount))} / semana - {deleteDraft.userIds.length} usuarios
                            </div>
                        </div>
                    ) : null}

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:justify-end">
                        <IconButton
                            icon="close"
                            label="Cancelar"
                            onClick={() => setDeleteDraft(null)}
                            disabled={saving}
                        />
                        <IconButton
                            icon="trash"
                            label={saving ? "Eliminando" : "Eliminar grupo"}
                            variant="danger"
                            onClick={confirmDeleteGroup}
                            disabled={saving || isClosed}
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
            <div className="text-[11px] font-semibold text-[#667085]">{label}</div>
            <div
                className={
                    tone === "green"
                        ? "mt-1 text-[16px] font-semibold text-emerald-600"
                        : tone === "red"
                            ? "mt-1 text-[16px] font-semibold text-red-500"
                            : "mt-1 text-[16px] font-semibold text-[#172033]"
                }
            >
                {value}
            </div>
        </div>
    );
}

function ClosedWeekPanel({
    summary,
    finalSummary,
}: {
    summary: AccountingSummary;
    finalSummary: NonNullable<WeeklyInvestmentDoc["finalSummary"]>;
}) {
    const hasDrift = snapshotDiffers(summary, finalSummary);

    return (
        <Card className="overflow-hidden border-emerald-200">
            <CardHeader
                title="Semana cerrada"
                subtitle={`Cierre guardado el ${formatDateTime(finalSummary.closedAt)}`}
                action={
                    <Badge tone={hasDrift ? "yellow" : "green"}>
                        {hasDrift ? "Diferencias" : "Snapshot vigente"}
                    </Badge>
                }
            />

            <div className="grid gap-4 border-t border-[#eef1f5] p-4 md:grid-cols-4">
                <MiniInvestmentStat label="Bruta final" value={money(finalSummary.gross)} />
                <MiniInvestmentStat label="Inversion final" value={money(finalSummary.investment)} />
                <MiniInvestmentStat label="Real final" value={money(finalSummary.real)} tone={finalSummary.real >= 0 ? "green" : "red"} />
                <MiniInvestmentStat label="ROI final" value={formatPercent(finalSummary.roi)} />
            </div>

            <div className="grid gap-3 border-t border-[#eef1f5] bg-[#f9fafb] p-4 text-[12px] font-semibold text-[#667085] sm:grid-cols-5">
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Asignados</span>
                    <span className="mt-1 block text-[#172033]">{finalSummary.assigned ?? 0}</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Visitados</span>
                    <span className="mt-1 block text-[#172033]">{finalSummary.visited}</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Rechazados</span>
                    <span className="mt-1 block text-[#172033]">{finalSummary.rejected}</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Suscripciones</span>
                    <span className="mt-1 block text-[#172033]">{finalSummary.subscriptionsPaid} pagadas</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Usuarios</span>
                    <span className="mt-1 block text-[#172033]">{finalSummary.rowsCount} incluidos</span>
                </div>
            </div>

            {hasDrift ? (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
                    El calculo actual ya no coincide exactamente con el snapshot final. Reabre y vuelve a cerrar si quieres actualizar el cierre.
                </div>
            ) : null}
        </Card>
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
            {name === "activity" ? <path {...common} d="M22 12h-4l-3 8L9 4l-3 8H2" /> : null}
            {name === "arrowLeft" ? <path {...common} d="M19 12H5M12 19l-7-7 7-7" /> : null}
            {name === "arrowRight" ? <path {...common} d="M5 12h14M12 5l7 7-7 7" /> : null}
            {name === "calendar" ? (
                <>
                    <path {...common} d="M8 2v4M16 2v4M3 10h18" />
                    <rect {...common} x="3" y="4" width="18" height="18" rx="2" />
                </>
            ) : null}
            {name === "check" ? <path {...common} d="M20 6 9 17l-5-5" /> : null}
            {name === "download" ? (
                <>
                    <path {...common} d="M12 3v12" />
                    <path {...common} d="m7 10 5 5 5-5" />
                    <path {...common} d="M5 21h14" />
                </>
            ) : null}
            {name === "refresh" ? (
                <>
                    <path {...common} d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                    <path {...common} d="M3 21v-5h5" />
                    <path {...common} d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                    <path {...common} d="M21 3v5h-5" />
                </>
            ) : null}
            {name === "plus" ? <path {...common} d="M12 5v14M5 12h14" /> : null}
            {name === "moreHorizontal" ? (
                <>
                    <circle {...common} cx="5" cy="12" r="1" />
                    <circle {...common} cx="12" cy="12" r="1" />
                    <circle {...common} cx="19" cy="12" r="1" />
                </>
            ) : null}
            {name === "settings" ? (
                <>
                    <path {...common} d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
                    <path {...common} d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 0 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.08 1.65V21a2.1 2.1 0 0 1-4.2 0v-.07a1.8 1.8 0 0 0-1.08-1.65 1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.18 13H2a2.1 2.1 0 1 1 0-4.2h.07A1.8 1.8 0 0 0 3.72 7.7a1.8 1.8 0 0 0-.36-2l-.05-.05a2.1 2.1 0 1 1 2.97-2.97l.05.05a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 9.4 1.45V1.4a2.1 2.1 0 1 1 4.2 0v.07a1.8 1.8 0 0 0 1.08 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 1 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 20.93 9H21a2.1 2.1 0 1 1 0 4.2h-.07A1.8 1.8 0 0 0 19.4 15Z" />
                </>
            ) : null}
            {name === "trash" ? (
                <>
                    <path {...common} d="M3 6h18" />
                    <path {...common} d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path {...common} d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path {...common} d="M10 11v6M14 11v6" />
                </>
            ) : null}
            {name === "edit" ? (
                <>
                    <path {...common} d="M12 20h9" />
                    <path {...common} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                </>
            ) : null}
            {name === "lock" ? (
                <>
                    <rect {...common} x="5" y="11" width="14" height="10" rx="2" />
                    <path {...common} d="M8 11V7a4 4 0 0 1 8 0v4" />
                </>
            ) : null}
            {name === "unlock" ? (
                <>
                    <rect {...common} x="5" y="11" width="14" height="10" rx="2" />
                    <path {...common} d="M8 11V7a4 4 0 0 1 7.4-2.1" />
                </>
            ) : null}
            {name === "pause" ? <path {...common} d="M8 5v14M16 5v14" /> : null}
            {name === "play" ? <path {...common} d="m8 5 11 7-11 7V5Z" /> : null}
            {name === "users" ? (
                <>
                    <path {...common} d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
                    <circle {...common} cx="9" cy="7" r="4" />
                    <path {...common} d="M22 20v-1.5a4 4 0 0 0-3-3.8" />
                </>
            ) : null}
            {name === "x" ? <path {...common} d="M18 6 6 18M6 6l12 12" /> : null}
        </svg>
    );
}

function CounterPill({ icon, label }: { icon: IconName; label: string }) {
    return (
        <div className="flex h-9 items-center gap-2 rounded-md border border-[#e4e7ec] bg-[#f9fafb] px-3 text-[12px] font-semibold text-[#344054]">
            <Icon name={icon} />
            <span>{label}</span>
        </div>
    );
}

function StatusPill({ status }: { status: WeeklyInvestmentDoc["status"] }) {
    const label = status === "closed" ? "Cerrada" : status === "review" ? "En revision" : "Abierta";
    const className =
        status === "closed"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : status === "review"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-[#e4e7ec] bg-[#f9fafb] text-[#344054]";

    return (
        <span className={`inline-flex h-9 items-center rounded-md border px-3 text-[12px] font-semibold ${className}`}>
            {label}
        </span>
    );
}

function InvestmentGroupManageCard({
    index,
    group,
    disabled,
    onEdit,
    onDelete,
    onToggleActive,
}: {
    index: number;
    group: GroupDraft;
    disabled: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onToggleActive: () => void;
}) {
    return (
        <details className="group relative rounded-lg border border-[#e4e7ec] bg-white p-3">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-[12px] font-semibold text-[#172033]">
                            {group.name || `Grupo ${index + 1}`}
                        </div>
                        <Badge tone={group.active ? "green" : "gray"}>
                            {group.active ? "Activo" : "Inactivo"}
                        </Badge>
                    </div>
                    <div className="mt-1 text-[11px] font-medium text-[#98a2b3]">
                        {money(parseMoney(group.amount))} / semana - {group.userIds.length} usuarios
                    </div>
                </div>

                <span
                    aria-label="Opciones del grupo"
                    title="Opciones del grupo"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#e4e7ec] bg-white text-[#667085] shadow-sm transition hover:bg-[#f9fafb] hover:text-[#172033]"
                >
                    <Icon name="moreHorizontal" />
                </span>
            </summary>

            <div className="absolute right-3 top-12 z-20 hidden w-40 overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-[0_18px_45px_rgba(16,25,54,0.18)] group-open:block">
                <button
                    type="button"
                    onClick={onEdit}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-[#344054] hover:bg-[#f8f7ff]"
                >
                    <Icon name="edit" />
                    <span>Editar</span>
                </button>
                <button
                    type="button"
                    onClick={onToggleActive}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 border-t border-[#e4e7ec] px-3 py-2.5 text-left text-[12px] font-semibold text-[#344054] hover:bg-[#f8f7ff]"
                >
                    <Icon name={group.active ? "pause" : "play"} />
                    <span>{group.active ? "Inactivar" : "Activar"}</span>
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 border-t border-[#e4e7ec] px-3 py-2.5 text-left text-[12px] font-semibold text-red-600 hover:bg-red-50"
                >
                    <Icon name="trash" />
                    <span>Eliminar</span>
                </button>
            </div>
        </details>
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
        <div className="rounded-lg border border-[#e4e7ec] bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-[#eef1f5] px-3 py-3">
                <div>
                    <div className="text-[12px] font-semibold text-[#172033]">
                        Grupo {index + 1}
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-[#98a2b3]">
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
                        <div className="text-[11px] font-semibold text-[#667085]">
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
                        className="h-10 w-full rounded-lg border border-[#e4e7ec] bg-white px-3 text-[12px] font-semibold text-[#172033] outline-none transition focus:border-[#172033] disabled:bg-[#f9fafb] disabled:text-[#98a2b3]"
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
                        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-[#eef1f5] bg-[#f9fafb] p-2">
                            {selectedUsers.map((user) => (
                                <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => onToggleUser(user.id)}
                                    className="flex w-full items-center justify-between gap-3 rounded-md bg-white px-2 py-2 text-left text-[12px] font-semibold text-[#344054] hover:bg-red-50"
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate">
                                            {user.name || user.email || "Usuario"}
                                        </span>
                                        <span className="block truncate text-[10px] font-medium text-[#98a2b3]">
                                            {subscriptionCaption(user)}
                                        </span>
                                    </span>
                                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-500">
                                        <Icon name="x" />
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="mt-2 rounded-lg border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-3 py-3 text-[12px] font-semibold text-[#98a2b3]">
                            Ningun miembro asignado.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const ACCOUNTING_METRICS: Record<
    AccountingMetric,
    {
        label: string;
        shortLabel: string;
        description: string;
        tone: "purple" | "green" | "red" | "orange" | "slate";
        format: (value: number) => string;
    }
> = {
    real: {
        label: "Ganancia real",
        shortLabel: "Real",
        description: "bruta menos inversion",
        tone: "purple",
        format: money,
    },
    gross: {
        label: "Ganancia bruta",
        shortLabel: "Bruta",
        description: "visitas + suscripciones",
        tone: "green",
        format: money,
    },
    visited: {
        label: "Visitados",
        shortLabel: "Visitados",
        description: "clientes visitados",
        tone: "green",
        format: (value) => String(Math.round(value)),
    },
    rejected: {
        label: "Rechazados",
        shortLabel: "Rechazados",
        description: "clientes rechazados",
        tone: "red",
        format: (value) => String(Math.round(value)),
    },
    assigned: {
        label: "Asignados",
        shortLabel: "Asignados",
        description: "clientes asignados",
        tone: "orange",
        format: (value) => String(Math.round(value)),
    },
    cost: {
        label: "Costo",
        shortLabel: "Costo",
        description: "suscripcion + grupos",
        tone: "slate",
        format: money,
    },
};

function accountingMetricValue(row: AccountingSummary["rows"][number], metric: AccountingMetric) {
    if (metric === "visited") return row.visited;
    if (metric === "rejected") return row.rejected;
    if (metric === "assigned") return row.assigned;
    if (metric === "gross") return row.gross;
    if (metric === "cost") return row.cost;
    return row.real;
}

function dayKeysBetween(startDate: Date, endDate: Date) {
    const out: { key: string; label: string }[] = [];
    const cursor = new Date(startDate);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (cursor <= end) {
        const key = [
            cursor.getFullYear(),
            String(cursor.getMonth() + 1).padStart(2, "0"),
            String(cursor.getDate()).padStart(2, "0"),
        ].join("-");

        out.push({
            key,
            label: new Intl.DateTimeFormat("es", { weekday: "short", day: "2-digit" }).format(cursor),
        });
        cursor.setDate(cursor.getDate() + 1);
    }

    return out;
}

function eventMoneyValue(event: DailyEventDoc) {
    return safeNumber(
        event.amount,
        safeNumber(
            event.amountSnapshot,
            safeNumber(event.rateApplied, safeNumber(event.ratePerVisitSnapshot, 0))
        )
    );
}

function buildDailyChartSeries(
    events: DailyEventDoc[],
    assignments: AccountingAssignmentDoc[],
    startDate: Date,
    endDate: Date,
    metric: AccountingMetric
): ChartPoint[] {
    const days = dayKeysBetween(startDate, endDate);
    const totals = new Map(days.map((day) => [day.key, 0]));

    if (metric === "assigned") {
        const assignedClientIdsByDay = new Set<string>();
        for (const assignment of assignments) {
            if (!totals.has(assignment.assignedDayKey)) continue;
            const key = `${assignment.assignedDayKey}_${assignment.id}`;
            if (assignedClientIdsByDay.has(key)) continue;
            assignedClientIdsByDay.add(key);
            totals.set(assignment.assignedDayKey, safeNumber(totals.get(assignment.assignedDayKey), 0) + 1);
        }

        return days.map((day) => ({
            dayKey: day.key,
            label: day.label,
            value: safeNumber(totals.get(day.key), 0),
        }));
    }

    for (const event of events) {
        if (!totals.has(event.dayKey)) continue;

        let value = 0;
        if (metric === "visited") value = event.type === "visited" ? 1 : 0;
        if (metric === "rejected") value = event.type === "rejected" ? 1 : 0;
        if (metric === "gross") value = event.type === "visited" ? eventMoneyValue(event) : 0;
        if (metric === "real") value = event.type === "visited" ? eventMoneyValue(event) : 0;
        if (metric === "cost") value = 0;

        totals.set(event.dayKey, safeNumber(totals.get(event.dayKey), 0) + value);
    }

    return days.map((day) => ({
        dayKey: day.key,
        label: day.label,
        value: safeNumber(totals.get(day.key), 0),
    }));
}

function DashboardContent({
    summary,
    events,
    assignments,
    startDate,
    endDate,
    isClosed,
    onToggleSubscriptionPayment,
}: {
    summary: AccountingSummary;
    events: DailyEventDoc[];
    assignments: AccountingAssignmentDoc[];
    startDate: Date;
    endDate: Date;
    isClosed: boolean;
    onToggleSubscriptionPayment: (row: AccountingSummary["rows"][number]) => void;
}) {
    const [rankingMetric, setRankingMetric] = useState<AccountingMetric>("real");
    const [chartMetric, setChartMetric] = useState<AccountingMetric>("real");
    const [chartMode, setChartMode] = useState<ChartMode>("trend");
    const activeRows = useMemo(() => {
        return summary.rows.filter((row) => {
            return row.assigned > 0
                || row.visited > 0
                || row.rejected > 0
                || row.subscriptionPaid === true
                || Math.abs(Number(row.gross) || 0) > 0
                || Math.abs(Number(row.cost) || 0) > 0
                || Math.abs(Number(row.real) || 0) > 0;
        });
    }, [summary.rows]);
    const rankedRows = useMemo(() => {
        return [...activeRows].sort((a, b) => {
            return accountingMetricValue(b, rankingMetric) - accountingMetricValue(a, rankingMetric);
        });
    }, [activeRows, rankingMetric]);
    const chartRows = useMemo(() => {
        return [...activeRows]
            .sort((a, b) => Math.abs(accountingMetricValue(b, chartMetric)) - Math.abs(accountingMetricValue(a, chartMetric)))
            .slice(0, 8);
    }, [activeRows, chartMetric]);
    const maxChartValue = Math.max(
        1,
        ...chartRows.map((row) => Math.abs(accountingMetricValue(row, chartMetric)))
    );
    const chartMeta = ACCOUNTING_METRICS[chartMetric];
    const rankingMeta = ACCOUNTING_METRICS[rankingMetric];
    const chartSeries = useMemo(() => {
        return buildDailyChartSeries(events, assignments, startDate, endDate, chartMetric);
    }, [events, assignments, startDate, endDate, chartMetric]);

    return (
        <div className="space-y-4">
            <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
                <Card>
                    <CardHeader
                        title="Resultado semanal"
                        subtitle={`Analisis por ${chartMeta.label.toLowerCase()}.`}
                        action={
                            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                                <select
                                    value={chartMetric}
                                    onChange={(event) => setChartMetric(event.target.value as AccountingMetric)}
                                    className="h-10 min-w-0 rounded-xl border border-[#e4e7ec] bg-white px-2 text-[12px] font-semibold text-[#344054] outline-none sm:h-9 sm:rounded-lg sm:px-3"
                                >
                                    <option value="real">Ganancia real</option>
                                    <option value="gross">Ganancia bruta</option>
                                    <option value="assigned">Asignados</option>
                                    <option value="visited">Visitados</option>
                                    <option value="rejected">Rechazados</option>
                                    <option value="cost">Costo</option>
                                </select>
                                <select
                                    value={chartMode}
                                    onChange={(event) => setChartMode(event.target.value as ChartMode)}
                                    className="h-10 min-w-0 rounded-xl border border-[#e4e7ec] bg-white px-2 text-[12px] font-semibold text-[#344054] outline-none sm:h-9 sm:rounded-lg sm:px-3"
                                >
                                    <option value="trend">Linea semanal</option>
                                    <option value="bars">Barras</option>
                                    <option value="mix">Comparativo</option>
                                    <option value="share">Participacion</option>
                                </select>
                            </div>
                        }
                    />

                    <div className="border-t border-[#eef1f5] p-3 sm:p-5">
                        <div className="grid grid-cols-3 gap-2 sm:gap-4">
                            <Metric label="Ganancia bruta" value={money(summary.gross)} delta="+ semana" tone="green" />
                            <Metric
                                label="Inversion"
                                value={money(summary.investment)}
                                delta={`${money(summary.subscriptionInvestment)} subs + ${money(summary.groupInvestment)} grupos + ${money(summary.manualAdjustment)} ajuste`}
                                tone="neutral"
                            />
                            <Metric
                                label="Ganancia real"
                                value={money(summary.real)}
                                delta={`ROI ${formatPercent(summary.roi)}`}
                                tone={summary.real >= 0 ? "green" : "red"}
                            />
                        </div>

                        <AccountingChart
                            rows={chartRows}
                            series={chartSeries}
                            metric={chartMetric}
                            mode={chartMode}
                            maxValue={maxChartValue}
                        />
                    </div>
                </Card>

                <Card>
                    <CardHeader
                        title="Ranking por usuario"
                        subtitle="Cambia el criterio para comparar rendimiento."
                        action={
                            <select
                                value={rankingMetric}
                                onChange={(event) => setRankingMetric(event.target.value as AccountingMetric)}
                                className="h-10 w-full rounded-xl border border-[#e4e7ec] bg-white px-3 text-[12px] font-semibold text-[#344054] outline-none sm:h-9 sm:w-auto sm:rounded-lg"
                            >
                                <option value="real">Ganancia real</option>
                                <option value="assigned">Asignados</option>
                                <option value="visited">Visitados</option>
                                <option value="rejected">Rechazados</option>
                                <option value="gross">Ganancia bruta</option>
                                <option value="cost">Costo</option>
                            </select>
                        }
                    />

                    <div className="border-t border-[#eef1f5]">
                        <div className="grid grid-cols-[32px_1fr_82px] px-3 py-3 text-[10px] font-bold uppercase tracking-[0.06em] text-[#98a2b3] sm:grid-cols-[42px_1fr_90px] sm:px-4 sm:text-[11px] sm:font-medium sm:normal-case sm:tracking-normal">
                            <span>#</span>
                            <span>Usuario</span>
                            <span className="text-right">{rankingMeta.shortLabel}</span>
                        </div>

                        {rankedRows.slice(0, 7).map((row, index) => (
                            <div key={row.userId} className="grid grid-cols-[32px_1fr_82px] items-center border-t border-[#eef1f5] px-3 py-3 sm:grid-cols-[42px_1fr_90px] sm:px-4">
                                <span className="text-[12px] font-medium text-[#98a2b3]">{index + 1}.</span>

                                <div className="min-w-0">
                                    <div className="truncate text-[12px] font-semibold text-[#172033]">{row.name}</div>
                                    <div className="truncate text-[11px] font-medium text-[#98a2b3]">
                                        {row.billingMode === "weekly_subscription" ? "Suscripcion" : "Por visita"}
                                    </div>
                                </div>

                                <div className={metricValueClass(rankingMetric, accountingMetricValue(row, rankingMetric))}>
                                    {rankingMeta.format(accountingMetricValue(row, rankingMetric))}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </section>

            <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
                <AccountingMiniKpi label="Asignados" value={String(summary.assigned)} caption="Asignados semana" icon="assign" tone="orange" />
                <AccountingMiniKpi label="Visitados" value={String(summary.visited)} caption="Clientes visitados" icon="check" tone="green" />
                <AccountingMiniKpi label="Rechazados" value={String(summary.rejected)} caption="Clientes rechazados" icon="close" tone="red" />
                <AccountingMiniKpi label="Ventas" value={money(summaryNumber(summary, "grossVisits"))} caption="Por visita" icon="activity" tone="purple" />
                <AccountingMiniKpi
                    label="Suscripciones"
                    value={money(summaryNumber(summary, "grossSubscriptions"))}
                    caption={`${summaryNumber(summary, "subscriptionsPaid")} pagadas`}
                    icon="users"
                    tone="purple"
                />
            </section>

            <Card className="overflow-hidden">
                <CardHeader
                    title="Detalle por usuario"
                    subtitle="Separando modelo por visita y suscripcion semanal."
                    action={
                        <IconButton
                            icon="download"
                            label="Exportar Excel"
                            onClick={() => exportAccountingSheet(summary)}
                        />
                    }
                />

                <div className="border-t border-[#eef1f5]">
                    <div className="divide-y divide-[#eef1f5] lg:hidden">
                        {activeRows.map((row) => (
                            <AccountingUserMobileCard
                                key={row.userId}
                                row={row}
                                isClosed={isClosed}
                                onToggleSubscriptionPayment={onToggleSubscriptionPayment}
                            />
                        ))}
                    </div>

                    <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full min-w-[920px] border-collapse">
                        <thead>
                            <tr className="border-b border-[#eef1f5] bg-[#fcfcff] text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad]">
                                <th className="px-3 py-2.5">Usuario</th>
                                <th className="px-3 py-2.5">Modelo</th>
                                <th className="px-3 py-2.5">Asig. / Vis. / Rech.</th>
                                <th className="px-3 py-2.5 text-right">Bruta</th>
                                <th className="px-3 py-2.5 text-right">Costo</th>
                                <th className="px-3 py-2.5 text-right">Real</th>
                                <th className="px-3 py-2.5 text-right">Pago</th>
                            </tr>
                        </thead>

                        <tbody>
                            {activeRows.map((row) => (
                                <tr key={row.userId} className="border-b border-[#eef1f5] last:border-0 hover:bg-[#f9fafb]">
                                    <td className="px-3 py-2.5">
                                        <div className="text-[12px] font-semibold text-[#172033]">{row.name}</div>
                                        <div className="mt-0.5 text-[11px] font-medium text-[#98a2b3]">{row.email || "Sin correo registrado"}</div>
                                    </td>

                                    <td className="px-3 py-2.5">
                                        <ModelBadge mode={row.billingMode} paid={row.subscriptionPaid} />
                                    </td>

                                    <td className="px-3 py-2.5">
                                        <span className="inline-flex overflow-hidden rounded-lg border border-[#e4e7ec] text-[11px] font-bold">
                                            <span className="bg-orange-50 px-2 py-1 text-orange-600">{row.assigned}</span>
                                            <span className="bg-emerald-50 px-2 py-1 text-emerald-700">{row.visited}</span>
                                            <span className="bg-red-50 px-2 py-1 text-red-600">{row.rejected}</span>
                                        </span>
                                    </td>

                                    <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-[#172033]">{money(row.gross)}</td>
                                    <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-[#667085]">{money(row.cost)}</td>
                                    <td className={row.real >= 0 ? "px-3 py-2.5 text-right text-[12px] font-semibold text-emerald-600" : "px-3 py-2.5 text-right text-[12px] font-semibold text-red-500"}>
                                        {money(row.real)}
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                        {row.billingMode === "weekly_subscription" ? (
                                            <Button
                                                onClick={() => onToggleSubscriptionPayment(row)}
                                                disabled={isClosed}
                                                className={
                                                    row.subscriptionPaid
                                                        ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                        : ""
                                                }
                                            >
                                                {row.subscriptionPaid ? "Pagada" : "Marcar pago"}
                                            </Button>
                                        ) : (
                                            <span className="text-[11px] font-semibold text-[#98a2b3]">-</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            </Card>
        </div>
    );
}

function metricValueClass(metric: AccountingMetric, value: number) {
    const base = "text-right text-[12px] font-semibold";
    if (metric === "rejected") return `${base} text-red-500`;
    if (metric === "visited") return `${base} text-emerald-600`;
    if (metric === "assigned") return `${base} text-orange-600`;
    if (metric === "cost") return `${base} text-[#667085]`;
    if (metric === "gross") return `${base} text-emerald-600`;
    return value >= 0 ? `${base} text-emerald-600` : `${base} text-red-500`;
}

function AccountingMiniKpi({
    label,
    value,
    caption,
    icon,
    tone,
}: {
    label: string;
    value: string;
    caption: string;
    icon: Parameters<typeof AppIcon>[0]["name"];
    tone: Parameters<typeof AppIcon>[0]["tone"];
}) {
    return (
        <div className="rounded-2xl border border-[#e8e7fb] bg-white px-3 py-2.5 shadow-[0_10px_28px_rgba(16,25,54,0.045)]">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-[9px] font-black uppercase tracking-[0.08em] text-[#8a93ad] sm:text-[10px]">
                        {label}
                    </div>
                    <div className="mt-1 truncate text-[18px] font-black leading-none tracking-[-0.04em] text-[#101936] sm:text-[20px]">
                        {value}
                    </div>
                </div>
                <AppIcon name={icon} tone={tone} size="sm" className="h-7 w-7 rounded-xl" />
            </div>
            <div className="mt-1 truncate text-[10px] font-semibold text-[#66739a] sm:text-[11px]">
                {caption}
            </div>
        </div>
    );
}

function chartFillClass(metric: AccountingMetric, value: number) {
    if (metric === "rejected") return "bg-[#ef4444]";
    if (metric === "visited") return "bg-emerald-500";
    if (metric === "assigned") return "bg-orange-400";
    if (metric === "cost") return "bg-slate-400";
    if (metric === "gross") return "bg-emerald-500";
    return value >= 0 ? "bg-[#7c3aed]" : "bg-[#ef4444]";
}

function AccountingChart({
    rows,
    series,
    metric,
    mode,
    maxValue,
}: {
    rows: AccountingSummary["rows"];
    series: ChartPoint[];
    metric: AccountingMetric;
    mode: ChartMode;
    maxValue: number;
}) {
    const meta = ACCOUNTING_METRICS[metric];
    const total = rows.reduce((sum, row) => sum + Math.abs(accountingMetricValue(row, metric)), 0);
    const maxSeriesValue = Math.max(1, ...series.map((point) => Math.abs(point.value)));

    if (!rows.length) {
        return (
            <div className="mt-4 flex h-[150px] items-center justify-center rounded-2xl border border-dashed border-[#d8ddea] bg-[#fbfaff] text-[12px] font-semibold text-[#98a2b3] sm:mt-6 sm:h-[210px]">
                Sin datos para graficar esta semana.
            </div>
        );
    }

    if (mode === "trend") {
        const width = 640;
        const height = 220;
        const padX = 34;
        const padTop = 22;
        const padBottom = 42;
        const plotHeight = height - padTop - padBottom;
        const step = series.length > 1 ? (width - padX * 2) / (series.length - 1) : 0;
        const points = series.map((point, index) => {
            const x = padX + step * index;
            const y = padTop + plotHeight - (Math.abs(point.value) / maxSeriesValue) * plotHeight;
            return { ...point, x, y };
        });
        const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
        const areaPath = `${path} L ${points.at(-1)?.x ?? padX} ${height - padBottom} L ${padX} ${height - padBottom} Z`;
        const bestPoint = points.reduce<ChartPoint | null>((best, point) => {
            if (!best) return point;
            return Math.abs(point.value) > Math.abs(best.value) ? point : best;
        }, null);

        return (
            <div className="mt-4 rounded-2xl border border-[#eef1f5] bg-gradient-to-b from-white to-[#fbfaff] p-3 sm:mt-6 sm:p-4">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8a93ad] sm:text-[11px]">
                            Tendencia semanal
                        </div>
                        <div className="mt-1 text-[18px] font-black tracking-[-0.04em] text-[#101936] sm:text-[22px]">
                            {meta.format(series.reduce((sum, point) => sum + point.value, 0))}
                        </div>
                    </div>
                    <div className="rounded-xl border border-[#e8e7fb] bg-white px-3 py-2 text-right shadow-sm">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#98a2b3]">
                            Mejor dia
                        </div>
                        <div className="mt-0.5 text-[13px] font-bold text-[#7c3aed]">
                            {bestPoint ? `${bestPoint.label} · ${meta.format(bestPoint.value)}` : "-"}
                        </div>
                    </div>
                </div>

                <svg viewBox={`0 0 ${width} ${height}`} className="h-[170px] w-full overflow-visible sm:h-[240px]">
                    <defs>
                        <linearGradient id={`accounting-area-${metric}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.24" />
                            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                        const y = padTop + plotHeight * tick;
                        return (
                            <line
                                key={tick}
                                x1={padX}
                                x2={width - padX}
                                y1={y}
                                y2={y}
                                stroke="#edf0f7"
                                strokeWidth="1"
                            />
                        );
                    })}
                    <path className="tg-chart-area" d={areaPath} fill={`url(#accounting-area-${metric})`} />
                    <path
                        key={`${metric}-${path}`}
                        className="tg-chart-line"
                        pathLength={1}
                        d={path}
                        fill="none"
                        stroke="#7c3aed"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    {points.map((point, index) => (
                        <g
                            key={point.dayKey}
                            className="tg-chart-point"
                            style={{ animationDelay: `${0.45 + index * 0.07}s` }}
                        >
                            <circle cx={point.x} cy={point.y} r="5" fill="#ffffff" stroke="#7c3aed" strokeWidth="3" />
                            <text x={point.x} y={height - 16} textAnchor="middle" className="fill-[#8a93ad] text-[11px] font-bold">
                                {point.label}
                            </text>
                        </g>
                    ))}
                </svg>
            </div>
        );
    }

    if (mode === "share") {
        return (
            <div className="mt-4 space-y-3 sm:mt-6">
                {rows.map((row, index) => {
                    const value = accountingMetricValue(row, metric);
                    const pct = total > 0 ? Math.max(4, Math.round((Math.abs(value) / total) * 100)) : 0;

                    return (
                        <div
                            key={row.userId}
                            className="tg-chart-row grid gap-2 sm:grid-cols-[120px_1fr_90px] sm:items-center"
                            style={{ animationDelay: `${index * 0.06}s` }}
                        >
                            <span className="truncate text-[11px] font-semibold text-[#344054]">{row.name}</span>
                            <div className="h-2.5 overflow-hidden rounded-full bg-[#eef1f7]">
                                <div
                                    className={`tg-chart-hbar h-full rounded-full ${chartFillClass(metric, value)}`}
                                    style={{ width: `${pct}%`, animationDelay: `${0.15 + index * 0.06}s` }}
                                />
                            </div>
                            <span className={metricValueClass(metric, value)}>
                                {meta.format(value)}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    }

    if (mode === "mix") {
        return (
            <div className="mt-4 grid gap-3 md:grid-cols-2 sm:mt-6">
                {rows.map((row, index) => {
                    const value = accountingMetricValue(row, metric);
                    const visitPct = row.assigned > 0 ? Math.round((row.visited / row.assigned) * 100) : 0;
                    const rejectPct = row.assigned > 0 ? Math.round((row.rejected / row.assigned) * 100) : 0;

                    return (
                        <div
                            key={row.userId}
                            className="tg-chart-row rounded-2xl border border-[#eef1f5] bg-[#fcfcff] p-3"
                            style={{ animationDelay: `${index * 0.06}s` }}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-[12px] font-bold text-[#172033]">{row.name}</div>
                                    <div className="mt-0.5 text-[11px] font-semibold text-[#98a2b3]">
                                        {row.assigned} asignados
                                    </div>
                                </div>
                                <div className={metricValueClass(metric, value)}>
                                    {meta.format(value)}
                                </div>
                            </div>
                            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[#eef1f7]">
                                <div
                                    className="tg-chart-hbar bg-emerald-500"
                                    style={{ width: `${visitPct}%`, animationDelay: `${0.18 + index * 0.06}s` }}
                                />
                                <div
                                    className="tg-chart-hbar bg-red-400"
                                    style={{ width: `${rejectPct}%`, animationDelay: `${0.28 + index * 0.06}s` }}
                                />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.04em] text-[#98a2b3]">
                                <span>{row.visited} visitados</span>
                                <span>{row.rejected} rechazados</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <>
            <div className="mt-5 h-[170px] sm:mt-8 sm:h-[230px]">
                <div className="flex h-full items-stretch gap-2 border-b border-l border-[#eef0f2] px-2 pb-0 sm:gap-3 sm:px-3">
                    {rows.map((row, index) => {
                        const value = accountingMetricValue(row, metric);
                        const pct = Math.max(8, Math.min(100, (Math.abs(value) / maxValue) * 100));

                        return (
                            <div key={row.userId} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                                <div className="flex min-h-0 w-full flex-1 items-end">
                                    <div
                                        className={`tg-chart-bar min-h-2 w-full rounded-t-md ${chartFillClass(metric, value)}`}
                                        style={{ height: `${pct}%`, animationDelay: `${index * 0.055}s` }}
                                        title={`${row.name}: ${meta.format(value)}`}
                                    />
                                </div>
                                <span className="max-w-[44px] truncate text-[9px] font-medium text-[#98a2b3] sm:max-w-[70px] sm:text-[10px]">
                                    {row.name}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] font-medium text-[#667085]">
                <Legend color={metric === "rejected" ? "red" : metric === "assigned" ? "orange" : "purple"} label={meta.label} />
                <Legend color="gray" label={meta.description} />
            </div>
        </>
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
        <div className="min-w-0 rounded-2xl border border-[#eef1f5] bg-white/70 p-2 sm:border-0 sm:bg-transparent sm:p-0">
            <div className="truncate text-[10px] font-black uppercase tracking-[0.06em] text-[#667085] sm:flex sm:items-center sm:gap-1 sm:text-[12px] sm:font-medium sm:normal-case sm:tracking-normal">
                {label}
            </div>

            <div className="mt-1 flex items-end gap-2 sm:mt-2">
                <span className="truncate text-[clamp(14px,4.8vw,20px)] font-black leading-none tracking-[-0.04em] text-[#172033] sm:text-[28px] sm:font-semibold">
                    {value}
                </span>
            </div>

            <div
                className={
                    tone === "green"
                        ? "mt-1 truncate text-[10px] font-semibold text-emerald-600 sm:text-[12px]"
                        : tone === "red"
                            ? "mt-1 truncate text-[10px] font-semibold text-red-500 sm:text-[12px]"
                            : "mt-1 truncate text-[10px] font-semibold text-[#98a2b3] sm:text-[12px]"
                }
            >
                {delta}
            </div>
        </div>
    );
}

function AccountingUserMobileCard({
    row,
    isClosed,
    onToggleSubscriptionPayment,
}: {
    row: AccountingSummary["rows"][number];
    isClosed: boolean;
    onToggleSubscriptionPayment: (row: AccountingSummary["rows"][number]) => void;
}) {
    return (
        <div className="px-3 py-3 sm:px-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-[#101936]">{row.name}</div>
                    <div className="mt-0.5 truncate text-[11px] font-medium text-[#8a93ad]">
                        {row.email || "Sin correo registrado"}
                    </div>
                </div>
                <div className={row.real >= 0 ? "text-right text-[14px] font-black text-emerald-600" : "text-right text-[14px] font-black text-red-500"}>
                    {money(row.real)}
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <ModelBadge mode={row.billingMode} paid={row.subscriptionPaid} />
            </div>

            <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-2xl border border-[#eef1f5] text-center text-[11px] font-black">
                <div className="bg-orange-50 px-2 py-2 text-orange-600">
                    <div>{row.assigned}</div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-[0.05em]">Asig.</div>
                </div>
                <div className="bg-emerald-50 px-2 py-2 text-emerald-700">
                    <div>{row.visited}</div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-[0.05em]">Vis.</div>
                </div>
                <div className="bg-red-50 px-2 py-2 text-red-600">
                    <div>{row.rejected}</div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-[0.05em]">Rech.</div>
                </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-2 text-[10px] font-semibold sm:p-3 sm:text-[11px]">
                <div>
                    <div className="text-[#98a2b3]">Bruta</div>
                    <div className="mt-1 text-[#172033]">{money(row.gross)}</div>
                </div>
                <div>
                    <div className="text-[#98a2b3]">Costo</div>
                    <div className="mt-1 text-[#667085]">{money(row.cost)}</div>
                </div>
                <div>
                    <div className="text-[#98a2b3]">Real</div>
                    <div className={row.real >= 0 ? "mt-1 text-emerald-600" : "mt-1 text-red-500"}>
                        {money(row.real)}
                    </div>
                </div>
            </div>

            {row.billingMode === "weekly_subscription" ? (
                <Button
                    onClick={() => onToggleSubscriptionPayment(row)}
                    disabled={isClosed}
                    className={
                        row.subscriptionPaid
                            ? "mt-3 w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            : "mt-3 w-full"
                    }
                >
                    {row.subscriptionPaid ? "Pagada" : "Marcar pago"}
                </Button>
            ) : null}
        </div>
    );
}

function Legend({
    color,
    label,
}: {
    color: "purple" | "red" | "gray" | "orange";
    label: string;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span
                className={
                    color === "purple"
                        ? "h-2 w-2 rounded-full bg-[#7c3aed]"
                        : color === "red"
                            ? "h-2 w-2 rounded-full bg-[#ef4444]"
                            : color === "orange"
                                ? "h-2 w-2 rounded-full bg-orange-400"
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
                {paid ? "Suscripcion pagada" : "Suscripcion no pagada"}
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
        .filter((group) => group.amount > 0 && group.userIds.length > 0);
}
