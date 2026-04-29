"use client";

import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { weekRangeKeysMonToSat, addDays, money } from "@/lib/date";
import {
    closeWeeklyInvestment,
    deleteInvestmentGroup,
    getWeeklyInvestment,
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
                    <tr><td class="title" colspan="9">TrackGo - Contabilidad semanal</td></tr>
                    <tr><td class="label">Semana</td><td colspan="8">${summary.startKey} a ${summary.endKey}</td></tr>
                    <tr><td class="section" colspan="9">Resumen</td></tr>
                    <tr>
                        <td class="label">Visitados</td><td class="num">${summary.visited}</td>
                        <td class="label">Rechazados</td><td class="num">${summary.rejected}</td>
                        <td class="label">Suscripciones pagadas</td><td class="num">${summary.subscriptionsPaid}</td>
                        <td class="label">ROI</td><td class="num" colspan="2">${summary.roi == null ? "" : summary.roi.toFixed(2) + "%"}</td>
                    </tr>
                    <tr>
                        <td class="label">Ganancia bruta</td><td class="money">${excelMoney(summary.gross)}</td>
                        <td class="label">Inversion</td><td class="money">${excelMoney(summary.investment)}</td>
                        <td class="label">Ganancia real</td><td class="money ${summary.real >= 0 ? "positive" : "negative"}">${excelMoney(summary.real)}</td>
                        <td class="label">Ajuste manual</td><td class="money" colspan="2">${excelMoney(summary.manualAdjustment)}</td>
                    </tr>
                    <tr>
                        <td class="label">Ventas por visita</td><td class="money">${excelMoney(summary.grossVisits)}</td>
                        <td class="label">Suscripciones</td><td class="money">${excelMoney(summary.grossSubscriptions)}</td>
                        <td class="label">Inversion suscripciones</td><td class="money">${excelMoney(summary.subscriptionInvestment)}</td>
                        <td class="label">Inversion grupos</td><td class="money" colspan="2">${excelMoney(summary.groupInvestment)}</td>
                    </tr>
                    <tr><td class="section" colspan="9">Detalle por usuario</td></tr>
                    <tr>
                        <th class="w-user">Usuario</th>
                        <th class="w-id">Email / ID</th>
                        <th class="w-model">Modelo</th>
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
    const [investment, setInvestment] = useState<WeeklyInvestmentDoc | null>(null);
    const [investmentGroups, setInvestmentGroups] = useState<InvestmentGroupDoc[]>([]);
    const [closeOpen, setCloseOpen] = useState(false);
    const [reopenOpen, setReopenOpen] = useState(false);

    const [loading, setLoading] = useState(true);
    const [savingWeek, setSavingWeek] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const week = useMemo(() => {
        return weekRangeKeysMonToSat(shiftWeek(new Date(), weekOffset));
    }, [weekOffset]);

    useEffect(() => {
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
    }, [week.startKey, week.endKey, weekOffset, refreshNonce]);

    const summary: AccountingSummary | null = useMemo(() => {
        return buildAccountingSummary({
            startKey: week.startKey,
            endKey: week.endKey,
            users,
            events,
            investment,
        });
    }, [week.startKey, week.endKey, users, events, investment]);

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
                        <StatusPill status={weekStatus} />
                        {summary ? (
                            <IconButton
                                icon="download"
                                label="Exportar Excel"
                                onClick={() => exportAccountingSheet(summary)}
                            />
                        ) : null}
                        <IconButton
                            icon="settings"
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
                            onClick={() => setRefreshNonce((value) => value + 1)}
                            disabled={loading}
                        />
                    </>
                }
            />

            <section className="mb-4 flex flex-col gap-3 rounded-lg border border-[#e4e7ec] bg-white px-3 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <IconButton
                        icon="arrowLeft"
                        label="Semana anterior"
                        onClick={() => setWeekOffset((v) => v - 1)}
                    />
                    <div className="flex h-9 items-center gap-2 rounded-md border border-[#e4e7ec] bg-[#f9fafb] px-3 text-[12px] font-semibold text-[#344054]">
                        <Icon name="calendar" />
                        <span>{week.startKey}</span>
                        <span className="text-[#98a2b3]">/</span>
                        <span>{week.endKey}</span>
                    </div>
                    <IconButton
                        icon="arrowRight"
                        label="Semana siguiente"
                        onClick={() => setWeekOffset((v) => v + 1)}
                    />
                    {weekOffset !== 0 ? (
                        <Button onClick={() => setWeekOffset(0)}>
                            Actual
                        </Button>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
                            icon="x"
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
                            icon="x"
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
                <StatCard label="Inversion total" value={money(totalInvestment)} caption={`${weekStartKey} a ${weekEndKey}`} />
                <StatCard label="Suscripciones" value={money(subscriptionInvestment)} caption={`${paidSubscriptionRows.length} pagadas`} />
                <StatCard label="Grupos activos" value={money(assigned)} caption={`${activeGroups.length} activos / ${validGroups.length} guardados`} />
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
                            className="h-full rounded-full bg-[#2563eb]"
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
                            icon="x"
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
                            icon="x"
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

            <div className="grid gap-3 border-t border-[#eef1f5] bg-[#f9fafb] p-4 text-[12px] font-semibold text-[#667085] sm:grid-cols-4">
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
        <details className="rounded-lg border border-[#e4e7ec] bg-white p-3">
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

            <div className="mt-3 overflow-hidden rounded-lg border border-[#e4e7ec] bg-[#f9fafb]">
                <button
                    type="button"
                    onClick={onEdit}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-[#344054] hover:bg-white"
                >
                    <Icon name="edit" />
                    <span>Editar</span>
                </button>
                <button
                    type="button"
                    onClick={onToggleActive}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 border-t border-[#e4e7ec] px-3 py-2 text-left text-[12px] font-semibold text-[#344054] hover:bg-white"
                >
                    <Icon name={group.active ? "pause" : "play"} />
                    <span>{group.active ? "Inactivar" : "Activar"}</span>
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 border-t border-[#e4e7ec] px-3 py-2 text-left text-[12px] font-semibold text-red-600 hover:bg-red-50"
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
                        <details className="mt-2 rounded-lg border border-[#eef1f5] bg-[#f9fafb]">
                            <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-[#344054]">
                                Ver o quitar miembros
                            </summary>
                            <div className="max-h-40 space-y-1 overflow-y-auto border-t border-[#eef1f5] p-2">
                                {selectedUsers.map((user) => (
                                    <button
                                        key={user.id}
                                        type="button"
                                        onClick={() => onToggleUser(user.id)}
                                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-[12px] font-semibold text-[#344054] hover:bg-white"
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate">
                                                {user.name || user.email || user.id}
                                            </span>
                                            <span className="block truncate text-[10px] font-medium text-[#98a2b3]">
                                                {subscriptionCaption(user)}
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
                        <div className="mt-2 rounded-lg border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-3 py-3 text-[12px] font-semibold text-[#98a2b3]">
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
    isClosed,
    onToggleSubscriptionPayment,
}: {
    summary: AccountingSummary;
    isClosed: boolean;
    onToggleSubscriptionPayment: (row: AccountingSummary["rows"][number]) => void;
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

                    <div className="border-t border-[#eef1f5] p-5">
                        <div className="grid gap-4 sm:grid-cols-3">
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
                                            <span className="max-w-[70px] truncate text-[10px] font-medium text-[#98a2b3]">
                                                {row.name}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] font-medium text-[#667085]">
                            <Legend color="blue" label="Resultado positivo" />
                            <Legend color="red" label="Resultado negativo" />
                            <Legend color="gray" label="Top usuarios" />
                        </div>
                    </div>
                </Card>

                <Card>
                    <CardHeader title="Ranking por usuario" subtitle="Ordenado por ganancia real." />

                    <div className="border-t border-[#eef1f5]">
                        <div className="grid grid-cols-[42px_1fr_90px] px-4 py-3 text-[11px] font-medium text-[#98a2b3]">
                            <span>#</span>
                            <span>Usuario</span>
                            <span className="text-right">Real</span>
                        </div>

                        {summary.rows.slice(0, 7).map((row, index) => (
                            <div key={row.userId} className="grid grid-cols-[42px_1fr_90px] items-center border-t border-[#eef1f5] px-4 py-3">
                                <span className="text-[12px] font-medium text-[#98a2b3]">{index + 1}.</span>

                                <div className="min-w-0">
                                    <div className="truncate text-[12px] font-semibold text-[#172033]">{row.name}</div>
                                    <div className="truncate text-[11px] font-medium text-[#98a2b3]">
                                        {row.billingMode === "weekly_subscription" ? "Suscripcion" : "Por visita"}
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
                    subtitle="Separando modelo por visita y suscripcion semanal."
                    action={
                        <IconButton
                            icon="download"
                            label="Exportar Excel"
                            onClick={() => exportAccountingSheet(summary)}
                        />
                    }
                />

                <div className="overflow-x-auto border-t border-[#eef1f5]">
                    <table className="w-full min-w-[920px] border-collapse">
                        <thead>
                            <tr className="border-b border-[#eef1f5] text-left text-[11px] font-medium text-[#98a2b3]">
                                <th className="px-4 py-3">Usuario</th>
                                <th className="px-4 py-3">Modelo</th>
                                <th className="px-4 py-3">Visitados</th>
                                <th className="px-4 py-3">Rechazados</th>
                                <th className="px-4 py-3 text-right">Bruta</th>
                                <th className="px-4 py-3 text-right">Costo</th>
                                <th className="px-4 py-3 text-right">Real</th>
                                <th className="px-4 py-3 text-right">Pago</th>
                            </tr>
                        </thead>

                        <tbody>
                            {summary.rows.map((row) => (
                                <tr key={row.userId} className="border-b border-[#eef1f5] last:border-0 hover:bg-[#f9fafb]">
                                    <td className="px-4 py-3">
                                        <div className="text-[12px] font-semibold text-[#172033]">{row.name}</div>
                                        <div className="mt-0.5 text-[11px] font-medium text-[#98a2b3]">{row.email || row.userId}</div>
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

                                    <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#172033]">{money(row.gross)}</td>
                                    <td className="px-4 py-3 text-right text-[12px] font-semibold text-[#667085]">{money(row.cost)}</td>
                                    <td className={row.real >= 0 ? "px-4 py-3 text-right text-[12px] font-semibold text-emerald-600" : "px-4 py-3 text-right text-[12px] font-semibold text-red-500"}>
                                        {money(row.real)}
                                    </td>
                                    <td className="px-4 py-3 text-right">
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
            </Card>
        </div>
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
            <div className="flex items-center gap-1 text-[12px] font-medium text-[#667085]">
                {label}
            </div>

            <div className="mt-2 flex items-end gap-2">
                <span className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-[#172033]">
                    {value}
                </span>
            </div>

            <div
                className={
                    tone === "green"
                        ? "mt-1 text-[12px] font-semibold text-emerald-600"
                        : tone === "red"
                            ? "mt-1 text-[12px] font-semibold text-red-500"
                            : "mt-1 text-[12px] font-semibold text-[#98a2b3]"
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
