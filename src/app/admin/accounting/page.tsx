"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { weekRangeKeysMonToSun, addDays, money } from "@/lib/date";
import {
    closeWeeklyInvestment,
    deleteInvestmentGroup,
    getWeeklyInvestment,
    listClientAssignmentsByRange,
    listInvestmentGroups,
    listAccountingUsers,
    listAdminUsers,
    listDailyEventsByRange,
    listPaidSubscriptionsByRange,
    reopenWeeklyInvestment,
    updateDailyEventRate,
    updateWeeklySubscriptionPayment,
    upsertInvestmentGroup,
    upsertWeeklyInvestment,
} from "@/data/accountingRepo";
import { listWeeklyExpenses } from "@/data/gastosRepo";
import { buildAccountingSummary } from "@/features/accounting/calcAccounting";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCan } from "@/features/auth/usePermissions";
import type {
    AccountingSummary,
    AccountingAssignmentDoc,
    AccountingSubscriptionDoc,
    DailyEventDoc,
    InvestmentGroupDoc,
    UserDoc,
    WeeklyExpenseDoc,
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
type AccountingPeriodMode = "weekly" | "monthly";
type AccountingMetric = "real" | "gross" | "visited" | "rejected" | "assigned" | "cost";
type ChartMode = "trend" | "bars" | "share";
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

function shiftMonth(base: Date, offset: number) {
    return new Date(base.getFullYear(), base.getMonth() + offset, 1);
}

function dateKey(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function monthRange(offset: number) {
    const startDate = shiftMonth(new Date(), offset);
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    return {
        startDate,
        endDate,
        startKey: dateKey(startDate),
        endKey: dateKey(endDate),
    };
}

function monthWeekRanges(startDate: Date, endDate: Date) {
    const ranges: ReturnType<typeof weekRangeKeysMonToSun>[] = [];
    const seen = new Set<string>();
    let cursor = new Date(startDate);
    cursor.setHours(12, 0, 0, 0);
    const endMs = endDate.getTime();

    while (cursor.getTime() <= endMs) {
        const week = weekRangeKeysMonToSun(cursor);
        if (!seen.has(week.startKey)) {
            ranges.push(week);
            seen.add(week.startKey);
        }
        cursor = addDays(week.endDate, 1);
        cursor.setHours(12, 0, 0, 0);
    }

    return ranges;
}

function mergeMonthlyInvestment(weeks: WeeklyInvestmentDoc[]): WeeklyInvestmentDoc | null {
    if (!weeks.length) return null;
    const groups = new Map<string, WeeklyInvestmentGroup>();
    const allocations: Record<string, number> = {};
    let amount = 0;

    for (const week of weeks) {
        amount += safeNumber(week.amount, 0);
        for (const [userId, value] of Object.entries(week.allocations ?? {})) {
            allocations[userId] = Math.round(((allocations[userId] ?? 0) + safeNumber(value, 0)) * 100) / 100;
        }
        for (const group of week.groups ?? []) {
            const key = group.groupId || group.id || group.name;
            const current = groups.get(key) ?? { ...group, id: key, amount: 0, userIds: [] };
            current.amount = Math.round((safeNumber(current.amount, 0) + safeNumber(group.amount, 0)) * 100) / 100;
            current.userIds = Array.from(new Set([...(current.userIds ?? []), ...(group.userIds ?? [])]));
            groups.set(key, current);
        }
    }

    return {
        id: "monthly",
        weekStartKey: weeks[0]?.weekStartKey ?? "",
        weekEndKey: weeks.at(-1)?.weekEndKey ?? "",
        amount: Math.round(amount * 100) / 100,
        allocations,
        groups: Array.from(groups.values()),
        status: "draft",
    };
}

function inKeyRange(key: string | undefined, startKey: string, endKey: string) {
    return Boolean(key && key >= startKey && key <= endKey);
}

function endOfRangeMs(date: Date) {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end.getTime();
}

function combineAccountingSummaries(summaries: AccountingSummary[], startKey: string, endKey: string): AccountingSummary {
    const rows = new Map<string, AccountingSummary["rows"][number]>();
    const subscriptionRows = summaries.flatMap((summary) => summary.subscriptionRows);

    for (const summary of summaries) {
        for (const row of summary.rows) {
            const current = rows.get(row.userId) ?? {
                ...row,
                assigned: 0,
                visited: 0,
                rejected: 0,
                gross: 0,
                cost: 0,
                real: 0,
                subscriptionPaid: false,
                subscriptionCount: 0,
                subscriptionCities: [],
            };
            const cities = Array.from(new Set([...(current.subscriptionCities ?? []), ...(row.subscriptionCities ?? [])]));
            rows.set(row.userId, {
                ...current,
                billingMode: row.subscriptionSource === "real" ? "weekly_subscription" : current.billingMode,
                assigned: current.assigned + row.assigned,
                visited: current.visited + row.visited,
                rejected: current.rejected + row.rejected,
                gross: safeNumber(current.gross) + row.gross,
                cost: safeNumber(current.cost) + row.cost,
                real: safeNumber(current.real) + row.real,
                subscriptionPaid: current.subscriptionPaid === true || row.subscriptionPaid === true,
                subscriptionSource: current.subscriptionSource === "real" || row.subscriptionSource === "real"
                    ? "real"
                    : current.subscriptionSource === "manual" || row.subscriptionSource === "manual"
                        ? "manual"
                        : "none",
                subscriptionCount: safeNumber(current.subscriptionCount) + safeNumber(row.subscriptionCount),
                subscriptionCities: cities,
            });
        }
    }

    const visited = summaries.reduce((sum, item) => sum + item.visited, 0);
    const rejected = summaries.reduce((sum, item) => sum + item.rejected, 0);
    const assigned = summaries.reduce((sum, item) => sum + item.assigned, 0);
    const gross = Math.round(summaries.reduce((sum, item) => sum + item.gross, 0) * 100) / 100;
    const grossVisits = Math.round(summaries.reduce((sum, item) => sum + item.grossVisits, 0) * 100) / 100;
    const grossSubscriptions = Math.round(summaries.reduce((sum, item) => sum + item.grossSubscriptions, 0) * 100) / 100;
    const subscriptionsPaid = summaries.reduce((sum, item) => sum + item.subscriptionsPaid, 0);
    const subscriptionInvestment = Math.round(summaries.reduce((sum, item) => sum + item.subscriptionInvestment, 0) * 100) / 100;
    const groupInvestment = Math.round(summaries.reduce((sum, item) => sum + item.groupInvestment, 0) * 100) / 100;
    const manualAdjustment = Math.round(summaries.reduce((sum, item) => sum + item.manualAdjustment, 0) * 100) / 100;
    const investment = Math.round((subscriptionInvestment + groupInvestment + manualAdjustment) * 100) / 100;
    const real = Math.round((gross - investment) * 100) / 100;

    return {
        startKey,
        endKey,
        visited,
        rejected,
        assigned,
        gross,
        grossVisits,
        grossSubscriptions,
        subscriptionsPaid,
        investment,
        subscriptionInvestment,
        groupInvestment,
        manualAdjustment,
        real,
        roi: investment > 0 ? (real / investment) * 100 : null,
        rows: Array.from(rows.values())
            .map((row) => ({
                ...row,
                gross: Math.round(row.gross * 100) / 100,
                cost: Math.round(row.cost * 100) / 100,
                real: Math.round(row.real * 100) / 100,
            }))
            .sort((a, b) => b.real - a.real),
        subscriptionRows: subscriptionRows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    };
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

function effectiveRate(event: DailyEventDoc, userRatePerVisit?: number): number {
    const amount = safeNumber(event.amount, NaN);
    if (Number.isFinite(amount)) return amount;
    const amountSnapshot = safeNumber(event.amountSnapshot, NaN);
    if (Number.isFinite(amountSnapshot)) return amountSnapshot;
    const rateApplied = safeNumber(event.rateApplied, NaN);
    if (Number.isFinite(rateApplied)) return rateApplied;
    const rateSnapshot = safeNumber(event.ratePerVisitSnapshot, NaN);
    if (Number.isFinite(rateSnapshot) && rateSnapshot > 0) return rateSnapshot;
    return safeNumber(userRatePerVisit, 0);
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

function subscriptionAccountingCost(subscription: AccountingSubscriptionDoc) {
    return subscription.adsBudget;
}

function summarizeSubscriptionsByUser(subscriptions: AccountingSubscriptionDoc[]) {
    const map = new Map<string, {
        gross: number;
        cost: number;
        count: number;
        cities: string[];
    }>();

    for (const subscription of subscriptions) {
        const current = map.get(subscription.userId) ?? {
            gross: 0,
            cost: 0,
            count: 0,
            cities: [],
        };
        const city = String(subscription.city || subscription.cityId || "").trim();
        map.set(subscription.userId, {
            gross: Math.round((current.gross + subscription.amount) * 100) / 100,
            cost: Math.round((current.cost + subscriptionAccountingCost(subscription)) * 100) / 100,
            count: current.count + 1,
            cities: city && !current.cities.includes(city) ? [...current.cities, city] : current.cities,
        });
    }

    return map;
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function downloadReceiptAsImage({
    adminName,
    weekStartKey,
    weekEndKey,
    gross,
    subscriptionInvestment,
    real,
    expensesTotal,
    expenses,
    miGanancia,
}: {
    adminName: string;
    weekStartKey: string;
    weekEndKey: string;
    gross: number;
    subscriptionInvestment: number;
    real: number;
    expensesTotal: number;
    expenses?: WeeklyExpenseDoc[];
    miGanancia: number;
}) {
    const dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
    const W = 520;
    const expLines = expenses ?? [];
    const extraH = expLines.length > 0 ? 22 + expLines.length * 22 + 28 : 0;
    const H = 340 + extraH;
    const canvas = document.createElement("canvas");
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#7C3AED");
    grad.addColorStop(1, "#4F46E5");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 6);

    ctx.fillStyle = "#7C3AED";
    ctx.font = "bold 20px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("TrackGo", 28, 44);

    ctx.fillStyle = "#66739a";
    ctx.font = "12px Arial, sans-serif";
    ctx.fillText("Recibo de cierre de semana", 28, 62);

    ctx.fillStyle = "#344054";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${weekStartKey}  –  ${weekEndKey}`, W - 28, 44);

    ctx.strokeStyle = "#e4e7ec";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(28, 80);
    ctx.lineTo(W - 28, 80);
    ctx.stroke();

    const summaryRows: { label: string; value: number; bold?: boolean; color?: string }[] = [
        { label: "Bruto total", value: gross },
        { label: "Inversion (suscripciones)", value: subscriptionInvestment },
    ];

    let y = 110;
    for (const row of summaryRows) {
        ctx.fillStyle = "#667085";
        ctx.font = "13px Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(row.label, 28, y);
        ctx.fillStyle = row.color ?? "#344054";
        ctx.font = row.bold ? "bold 13px Arial, sans-serif" : "13px Arial, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(money(row.value), W - 28, y);
        y += 30;
    }

    if (expLines.length > 0) {
        ctx.fillStyle = "#98a2b3";
        ctx.font = "10px Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("GASTOS", 28, y);
        y += 22;
        for (const expense of expLines) {
            const label = expense.name.length > 35 ? expense.name.slice(0, 35) + "…" : expense.name;
            ctx.fillStyle = "#667085";
            ctx.font = "11px Arial, sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(label, 28, y);
            ctx.fillStyle = "#dc2626";
            ctx.font = "11px Arial, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(money(expense.amount), W - 28, y);
            y += 22;
        }
        ctx.fillStyle = "#dc2626";
        ctx.font = "bold 12px Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("Total gastos", 28, y);
        ctx.textAlign = "right";
        ctx.fillText(money(expensesTotal), W - 28, y);
        y += 28;
    }

    // Draw Ganancia real row
    ctx.fillStyle = "#667085";
    ctx.font = "13px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Ganancia real", 28, y);
    ctx.fillStyle = real >= 0 ? "#047857" : "#dc2626";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(money(real), W - 28, y);
    y += 30;

    y += 8;
    ctx.fillStyle = "#ecfdf5";
    roundRect(ctx, 24, y - 22, W - 48, 52, 10);
    ctx.fill();
    ctx.fillStyle = "#065f46";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("MI GANANCIA", 36, y + 4);
    ctx.fillStyle = "#047857";
    ctx.font = "bold 22px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(money(miGanancia), W - 36, y + 4);

    y += 46;
    ctx.strokeStyle = "#e4e7ec";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(W - 28, y);
    ctx.stroke();

    y += 22;
    ctx.fillStyle = "#344054";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(adminName, 28, y);
    ctx.fillStyle = "#98a2b3";
    ctx.font = "11px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`Generado ${new Date().toLocaleDateString("es")}`, W - 28, y);

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `recibo-${adminName.replace(/\s+/g, "-")}-${weekStartKey}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function getExpenseShareFor(
    expenses: WeeklyExpenseDoc[],
    userId: string,
    superadminDefault: boolean
): number {
    return expenses.reduce((acc, e) => {
        if (!e.allocations || e.allocations.length === 0) {
            return superadminDefault ? acc + e.amount : acc;
        }
        const alloc = e.allocations.find((a) => a.userId === userId);
        return acc + (e.amount * (alloc?.percentage ?? 0) / 100);
    }, 0);
}

function DownloadSheet({
    open,
    onClose,
    onExcel,
    receipts,
}: {
    open: boolean;
    onClose: () => void;
    onExcel: () => void;
    receipts: { label: string; onClick: () => void }[];
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#101936]/40 backdrop-blur-sm sm:items-center" onClick={onClose}>
            <div
                className="w-full max-w-sm rounded-t-3xl bg-white px-5 pb-8 pt-5 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] sm:rounded-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#E8E7FB] sm:hidden" />
                <h3 className="text-[16px] font-black text-[#101936]">Descargar</h3>
                <p className="mt-1 mb-4 text-[13px] font-medium text-[#66739A]">Elige el formato.</p>
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => { onExcel(); onClose(); }}
                        className="flex min-h-[48px] w-full items-center gap-3 rounded-[14px] border border-[#e4e7ec] bg-[#f9fafb] px-4 text-[14px] font-bold text-[#344054] transition hover:bg-[#f3f0ff]"
                    >
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                        Exportar Excel
                    </button>
                    {receipts.map((r) => (
                        <button
                            key={r.label}
                            type="button"
                            onClick={() => { r.onClick(); onClose(); }}
                            className="flex min-h-[48px] w-full items-center gap-3 rounded-[14px] bg-[#7C3AED] px-4 text-[14px] font-bold text-white transition active:bg-violet-700"
                        >
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                            </svg>
                            Recibo · {r.label}
                        </button>
                    ))}
                    <button type="button" onClick={onClose} className="min-h-[44px] w-full rounded-[14px] border border-[#E8E7FB] bg-white text-[14px] font-bold text-[#66739A]">
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
}

function exportAccountingSheet(summary: AccountingSummary, miGanancia?: number | null, isSuperAdmin?: boolean, expenses?: WeeklyExpenseDoc[]) {
    const activeRows = summary.rows.filter((row) => {
        if (row.billingMode === "per_visit") return row.visited > 0;
        return row.subscriptionPaid === true;
    });
    const rows = activeRows
        .map((row) => {
            const model = row.subscriptionSource === "real"
                ? "Suscripcion pagada"
                : row.billingMode === "weekly_subscription"
                    ? "Suscripcion"
                    : "Por visita";
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
                        <td class="label">Inversion</td><td class="money">${excelMoney(isSuperAdmin ? summary.investment : summary.subscriptionInvestment)}</td>
                        <td class="label">Ganancia real</td><td class="money ${summary.real >= 0 ? "positive" : "negative"}">${excelMoney(summary.real)}</td>
                        <td class="label">ROI</td><td class="num">${summary.roi == null ? "" : summary.roi.toFixed(2) + "%"}</td>
                        ${isSuperAdmin ? `<td class="label">Ajuste manual</td><td class="money">${excelMoney(summary.manualAdjustment)}</td>` : "<td></td><td></td>"}
                    </tr>
                    ${miGanancia != null ? `<tr>
                        <td class="label">Mi ganancia</td><td class="money ${miGanancia >= 0 ? "positive" : "negative"}" colspan="9">${excelMoney(miGanancia)}</td>
                    </tr>` : ""}
                    <tr>
                        <td class="label">Ventas por visita</td><td class="money">${excelMoney(summary.grossVisits)}</td>
                        <td class="label">Suscripciones</td><td class="money">${excelMoney(summary.grossSubscriptions)}</td>
                        <td class="label">Inversion suscripciones</td><td class="money">${excelMoney(summary.subscriptionInvestment)}</td>
                        ${isSuperAdmin ? `<td class="label">Inversion grupos</td><td class="money" colspan="3">${excelMoney(summary.groupInvestment)}</td>` : "<td colspan=\"4\"></td>"}
                    </tr>
                    ${(expenses ?? []).length > 0 ? `
<tr><td class="section" colspan="10">Gastos de mantenimiento</td></tr>
<tr>
    <th class="w-user">Nombre</th>
    <th style="width:200px">Descripcion</th>
    <th style="width:260px">Reparto</th>
    <th class="money">Monto</th>
    <th colspan="6"></th>
</tr>
${(expenses ?? []).map(e => `<tr>
    <td class="text">${excelText(e.name)}</td>
    <td class="text">${excelText(e.description || "")}</td>
    <td class="text">${e.allocations && e.allocations.length > 0 ? e.allocations.map(a => excelText(a.name + " " + a.percentage + "%")).join(", ") : "100% Superadmin"}</td>
    <td class="money">${excelMoney(e.amount)}</td>
    <td colspan="6"></td>
</tr>`).join("")}
<tr>
    <td class="label">Total gastos</td><td class="money negative">${excelMoney(summary.expensesTotal ?? 0)}</td>
    <td colspan="8"></td>
</tr>` : ""}
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

function adminSellerAccountingStartMs(user: UserDoc, adminId: string, adminCreatedAt?: number) {
    const share = user.sharedWith?.find((entry) => entry.adminId === adminId);
    if (!share) return null;
    const startMs = Math.max(
        safeNumber(adminCreatedAt, 0),
        safeNumber(share.assignedAt, 0),
    );
    return startOfLocalDayMs(startMs);
}

function startOfLocalDayMs(value: number) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

export default function AccountingPage() {
    const { firebaseUser, profile, isSuperAdmin } = useAuth();
    const canAccounting = useCan("accountingView");
    const canInvestmentView = useCan("accountingInvestmentView");
    const canInvestmentEdit = useCan("accountingInvestmentEdit");
    const canClose = useCan("accountingClose");
    const canGastos = useCan("gastosView");
    const [activeTab, setActiveTab] = useState<AccountingTab>("overview");
    const [periodMode, setPeriodMode] = useState<AccountingPeriodMode>("weekly");
    const [weekOffset, setWeekOffset] = useState(0);
    const [monthOffset, setMonthOffset] = useState(0);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [assignments, setAssignments] = useState<AccountingAssignmentDoc[]>([]);
    const [subscriptions, setSubscriptions] = useState<AccountingSubscriptionDoc[]>([]);
    const [investment, setInvestment] = useState<WeeklyInvestmentDoc | null>(null);
    const [monthlyInvestments, setMonthlyInvestments] = useState<WeeklyInvestmentDoc[]>([]);
    const [investmentGroups, setInvestmentGroups] = useState<InvestmentGroupDoc[]>([]);
    const [expenses, setExpenses] = useState<WeeklyExpenseDoc[]>([]);
    const [adminUsers, setAdminUsers] = useState<UserDoc[]>([]);
    const [closeOpen, setCloseOpen] = useState(false);
    const [reopenOpen, setReopenOpen] = useState(false);
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [closeDownloadOpen, setCloseDownloadOpen] = useState(false);
    const [excludedUserIds, setExcludedUserIds] = useState<string[]>([]);

    const [loading, setLoading] = useState(true);
    const [savingWeek, setSavingWeek] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const week = useMemo(() => {
        return weekRangeKeysMonToSun(shiftWeek(new Date(), weekOffset));
    }, [weekOffset]);
    const month = useMemo(() => monthRange(monthOffset), [monthOffset]);
    const period = periodMode === "monthly" ? month : week;
    const periodOffset = periodMode === "monthly" ? monthOffset : weekOffset;
    const setPeriodOffset = periodMode === "monthly" ? setMonthOffset : setWeekOffset;

    useEffect(() => {
        if (periodMode === "monthly" && activeTab === "investment") {
            setActiveTab("overview");
        }
    }, [periodMode, activeTab]);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setErr(null);

            try {
                const weekRanges = periodMode === "monthly"
                    ? monthWeekRanges(period.startDate, period.endDate)
                    : [];
                const queryStartKey = periodMode === "monthly" && weekRanges[0] ? weekRanges[0].startKey : period.startKey;
                const queryEndKey = periodMode === "monthly" && weekRanges[weekRanges.length - 1] ? weekRanges[weekRanges.length - 1].endKey : period.endKey;
                const queryStartDate = periodMode === "monthly" && weekRanges[0] ? weekRanges[0].startDate : period.startDate;
                const queryEndDate = periodMode === "monthly" && weekRanges[weekRanges.length - 1] ? weekRanges[weekRanges.length - 1].endDate : period.endDate;

                const [u, ev, ass, subs, inv, groupCatalog, weekExpenses, admins] = await Promise.all([
                    listAccountingUsers(),
                    listDailyEventsByRange(queryStartKey, queryEndKey),
                    listClientAssignmentsByRange({
                        startKey: queryStartKey,
                        endKey: queryEndKey,
                        startMs: queryStartDate.getTime(),
                        endMs: endOfRangeMs(queryEndDate),
                    }),
                    listPaidSubscriptionsByRange({
                        startMs: queryStartDate.getTime(),
                        endMs: endOfRangeMs(queryEndDate),
                    }),
                    periodMode === "weekly"
                        ? getWeeklyInvestment(week.startKey)
                        : Promise.all(weekRanges.map((item) => getWeeklyInvestment(item.startKey))),
                    listInvestmentGroups(),
                    canGastos && periodMode === "weekly" ? listWeeklyExpenses(week.startKey) : Promise.resolve([] as WeeklyExpenseDoc[]),
                    canGastos ? listAdminUsers() : Promise.resolve([] as UserDoc[]),
                ]);

                if (cancelled) return;

                const loadedMonthlyInvestments = Array.isArray(inv) ? inv.filter(Boolean) as WeeklyInvestmentDoc[] : [];
                let weeklyInvestment = Array.isArray(inv) ? null : inv;
                if (!weeklyInvestment && periodMode === "weekly" && weekOffset === 0 && groupCatalog.length) {
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
                setSubscriptions(subs);
                setInvestment(weeklyInvestment);
                setMonthlyInvestments(loadedMonthlyInvestments);
                setInvestmentGroups(groupCatalog);
                setExpenses(weekExpenses);
                setAdminUsers(admins);
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
    }, [period.startKey, period.endKey, period.startDate, period.endDate, periodMode, week.startKey, week.endKey, weekOffset, refreshNonce]);

    const myUsers = useMemo(() => {
        if (isSuperAdmin || !profile) return users;
        const periodEndMs = new Date(period.endDate).setHours(23, 59, 59, 999);
        return users.filter((u) => {
            const startMs = adminSellerAccountingStartMs(u, profile.id, profile.createdAt);
            return startMs !== null && startMs <= periodEndMs;
        });
    }, [users, isSuperAdmin, profile, period.endDate]);

    const accountingStartByUser = useMemo(() => {
        const map = new Map<string, number>();
        if (isSuperAdmin || !profile) {
            users.forEach((user) => map.set(user.id, 0));
            return map;
        }

        for (const user of users) {
            const startMs = adminSellerAccountingStartMs(user, profile.id, profile.createdAt);
            if (startMs !== null) map.set(user.id, startMs);
        }
        return map;
    }, [users, isSuperAdmin, profile]);

    const scopedEvents = useMemo(
        () => isSuperAdmin
            ? events
            : events.filter((event) => event.createdAt >= (accountingStartByUser.get(event.userId) ?? Number.POSITIVE_INFINITY)),
        [events, isSuperAdmin, accountingStartByUser],
    );

    const scopedAssignments = useMemo(
        () => isSuperAdmin
            ? assignments
            : assignments.filter((assignment) => assignment.assignedAt >= (accountingStartByUser.get(assignment.userId) ?? Number.POSITIVE_INFINITY)),
        [assignments, isSuperAdmin, accountingStartByUser],
    );

    const scopedSubscriptions = useMemo(
        () => isSuperAdmin
            ? subscriptions
            : subscriptions.filter((subscription) => subscription.createdAt >= (accountingStartByUser.get(subscription.userId) ?? Number.POSITIVE_INFINITY)),
        [subscriptions, isSuperAdmin, accountingStartByUser],
    );

    const myInvestmentGroups = useMemo(() => {
        if (isSuperAdmin || !profile) return investmentGroups;
        const myIds = new Set(myUsers.map((u) => u.id));
        return investmentGroups.filter((g) => g.userIds.some((id) => myIds.has(id)));
    }, [investmentGroups, myUsers, isSuperAdmin, profile]);

    const myInvestment = useMemo(() => {
        const sourceInvestment = periodMode === "monthly" ? mergeMonthlyInvestment(monthlyInvestments) : investment;
        if (isSuperAdmin || !profile || !sourceInvestment) return sourceInvestment;
        return {
            ...sourceInvestment,
            amount: 0,
            allocations: {},
            groups: [],
        };
    }, [investment, monthlyInvestments, isSuperAdmin, profile, periodMode]);

    const weeklySummariesForMonth = useMemo(() => {
        if (periodMode !== "monthly") return [];
        return monthWeekRanges(period.startDate, period.endDate).map((weekRange) => {
            const weekEndMs = endOfRangeMs(weekRange.endDate);
            const weekUsers = isSuperAdmin || !profile
                ? myUsers
                : myUsers.filter((user) => {
                    const startMs = accountingStartByUser.get(user.id);
                    return startMs !== undefined && startMs <= weekEndMs;
                });
            const weekInvestment = monthlyInvestments.find((item) => item.weekStartKey === weekRange.startKey) ?? null;
            let scopedWeekInvestment = weekInvestment;
            if (!isSuperAdmin && profile && weekInvestment) {
                scopedWeekInvestment = {
                    ...weekInvestment,
                    amount: 0,
                    allocations: {},
                    groups: [],
                };
            }

            return buildAccountingSummary({
                startKey: weekRange.startKey,
                endKey: weekRange.endKey,
                users: weekUsers,
                events: scopedEvents.filter((event) => inKeyRange(event.dayKey, weekRange.startKey, weekRange.endKey)),
                assignments: scopedAssignments.filter((assignment) => inKeyRange(assignment.assignedDayKey, weekRange.startKey, weekRange.endKey)),
                subscriptions: scopedSubscriptions.filter((subscription) =>
                    subscription.createdAt >= weekRange.startDate.getTime() && subscription.createdAt <= endOfRangeMs(weekRange.endDate)
                ),
                investment: scopedWeekInvestment,
            });
        });
    }, [periodMode, period.startDate, period.endDate, monthlyInvestments, isSuperAdmin, profile, myUsers, accountingStartByUser, scopedEvents, scopedAssignments, scopedSubscriptions]);

    const summary: AccountingSummary | null = useMemo(() => {
        if (periodMode === "monthly") {
            return combineAccountingSummaries(weeklySummariesForMonth, period.startKey, period.endKey);
        }
        return buildAccountingSummary({
            startKey: period.startKey,
            endKey: period.endKey,
            users: myUsers,
            events: scopedEvents,
            assignments: scopedAssignments,
            subscriptions: scopedSubscriptions,
            investment: myInvestment,
            expenses,
        });
    }, [periodMode, weeklySummariesForMonth, period.startKey, period.endKey, myUsers, scopedEvents, scopedAssignments, scopedSubscriptions, myInvestment, expenses]);

    const miGanancia = useMemo(() => {
        if (!profile || !summary) return null;

        if (periodMode === "monthly") {
            const values = weeklySummariesForMonth
                .map((input): number | null => {
                    if (isSuperAdmin) {
                        const givenAway = input.rows.reduce((acc, row) => {
                            const user = myUsers.find((u) => u.id === row.userId);
                            const totalPct = (user?.sharedWith ?? []).reduce((s, sw) => s + sw.percentage, 0);
                            return acc + (row.real * totalPct / 100);
                        }, 0);
                        return givenAway === 0 ? null : input.real - givenAway;
                    }
                    return input.rows.reduce((acc, row) => {
                        const user = myUsers.find((u) => u.id === row.userId);
                        const share = user?.sharedWith?.find((s) => s.adminId === profile.id);
                        if (!share) return acc;
                        return acc + (row.real * share.percentage / 100);
                    }, 0);
                })
                .filter((value): value is number => value !== null);
            if (!values.length) return null;
            return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
        }

        if (isSuperAdmin) {
            const givenAway = summary.rows.reduce((acc, row) => {
                const user = myUsers.find((u) => u.id === row.userId);
                const totalPct = (user?.sharedWith ?? []).reduce((s, sw) => s + sw.percentage, 0);
                return acc + (row.real * totalPct / 100);
            }, 0);
            const expensesTotal = summary.expensesTotal ?? 0;
            const superadminExpenseShare = getExpenseShareFor(expenses, profile.id, true);
            const hasAllocations = expenses.some((e) => e.allocations && e.allocations.length > 0);
            if (givenAway === 0 && !hasAllocations) return null;
            return summary.real - givenAway + (expensesTotal - superadminExpenseShare);
        }

        const revenueShare = summary.rows.reduce((acc, row) => {
            const user = myUsers.find((u) => u.id === row.userId);
            const share = user?.sharedWith?.find((s) => s.adminId === profile.id);
            if (!share) return acc;
            return acc + (row.real * share.percentage / 100);
        }, 0);
        const adminExpenseShare = getExpenseShareFor(expenses, profile.id, false);
        return revenueShare - adminExpenseShare;
    }, [summary, myUsers, isSuperAdmin, profile, periodMode, weeklySummariesForMonth, expenses]);

    const miGananciaPerAdmin = useMemo(() => {
        if (!isSuperAdmin || !summary) return [] as { admin: UserDoc; gain: number }[];
        return adminUsers
            .map((admin) => {
                const revenueShare = summary.rows.reduce((acc, row) => {
                    const user = myUsers.find((u) => u.id === row.userId);
                    const share = user?.sharedWith?.find((s) => s.adminId === admin.id);
                    if (!share) return acc;
                    return acc + (row.real * share.percentage / 100);
                }, 0);
                const adminExpenseShare = getExpenseShareFor(expenses, admin.id, false);
                return { admin, gain: revenueShare - adminExpenseShare };
            })
            .filter(({ admin }) => myUsers.some((u) => u.sharedWith?.some((s) => s.adminId === admin.id)));
    }, [isSuperAdmin, summary, adminUsers, myUsers, expenses]);

    const adjustedCloseSummary = useMemo(() => {
        if (!summary || periodMode !== "weekly" || excludedUserIds.length === 0) return summary;
        const excludedSet = new Set(excludedUserIds);
        const modifiedUsers = myUsers.map((user) =>
            excludedSet.has(user.id)
                ? {
                    ...user,
                    weeklySubscriptionWeeks: {
                        ...(user.weeklySubscriptionWeeks ?? {}),
                        [week.startKey]: { ...(user.weeklySubscriptionWeeks?.[week.startKey] ?? {}), paid: false },
                    },
                }
                : user
        );
        const modifiedSubscriptions = scopedSubscriptions.filter((sub) => !excludedSet.has(sub.userId));
        return buildAccountingSummary({
            startKey: week.startKey,
            endKey: week.endKey,
            users: modifiedUsers,
            events: scopedEvents,
            assignments: scopedAssignments,
            subscriptions: modifiedSubscriptions,
            investment: myInvestment,
            expenses,
        });
    }, [summary, excludedUserIds, myUsers, week.startKey, week.endKey, scopedSubscriptions, scopedEvents, scopedAssignments, myInvestment, expenses, periodMode]);

    const closeMiGanancia = useMemo(() => {
        if (!profile || !adjustedCloseSummary) return null;
        const s = adjustedCloseSummary;
        if (isSuperAdmin) {
            const givenAway = s.rows.reduce((acc, row) => {
                const user = myUsers.find((u) => u.id === row.userId);
                const totalPct = (user?.sharedWith ?? []).reduce((sum, sw) => sum + sw.percentage, 0);
                return acc + (row.real * totalPct / 100);
            }, 0);
            const expensesTotal = s.expensesTotal ?? 0;
            const superadminExpenseShare = getExpenseShareFor(expenses, profile.id, true);
            const hasAllocations = expenses.some((e) => e.allocations && e.allocations.length > 0);
            if (givenAway === 0 && !hasAllocations) return null;
            return s.real - givenAway + (expensesTotal - superadminExpenseShare);
        }
        const revenueShare = s.rows.reduce((acc, row) => {
            const user = myUsers.find((u) => u.id === row.userId);
            const share = user?.sharedWith?.find((sw) => sw.adminId === profile.id);
            if (!share) return acc;
            return acc + (row.real * share.percentage / 100);
        }, 0);
        const adminExpenseShare = getExpenseShareFor(expenses, profile.id, false);
        return revenueShare - adminExpenseShare;
    }, [adjustedCloseSummary, myUsers, isSuperAdmin, profile, expenses]);

    const closeMiGananciaPerAdmin = useMemo(() => {
        if (!isSuperAdmin || !adjustedCloseSummary) return [] as { admin: UserDoc; gain: number }[];
        return adminUsers
            .map((admin) => {
                const revenueShare = adjustedCloseSummary.rows.reduce((acc, row) => {
                    const user = myUsers.find((u) => u.id === row.userId);
                    const share = user?.sharedWith?.find((s) => s.adminId === admin.id);
                    if (!share) return acc;
                    return acc + (row.real * share.percentage / 100);
                }, 0);
                const adminExpenseShare = getExpenseShareFor(expenses, admin.id, false);
                return { admin, gain: revenueShare - adminExpenseShare };
            })
            .filter(({ admin }) => myUsers.some((u) => u.sharedWith?.some((s) => s.adminId === admin.id)));
    }, [isSuperAdmin, adjustedCloseSummary, adminUsers, myUsers, expenses]);

    const weekStatus = periodMode === "weekly" ? investment?.status ?? "draft" : "draft";
    const isClosed = periodMode === "weekly" && weekStatus === "closed";

    const exportSummary = useMemo((): AccountingSummary | null => {
        if (!summary) return null;
        const fs = isClosed ? investment?.finalSummary : null;
        if (!fs) return summary;
        return {
            ...summary,
            gross: fs.gross,
            grossVisits: fs.grossVisits,
            grossSubscriptions: fs.grossSubscriptions,
            subscriptionsPaid: fs.subscriptionsPaid,
            investment: fs.investment,
            subscriptionInvestment: fs.subscriptionInvestment,
            groupInvestment: fs.groupInvestment,
            manualAdjustment: fs.manualAdjustment,
            real: fs.real,
            roi: fs.roi,
            visited: fs.visited,
            rejected: fs.rejected,
            assigned: fs.assigned ?? summary.assigned,
            rows: fs.rows ?? summary.rows,
            subscriptionRows: fs.subscriptionRows ?? summary.subscriptionRows,
            expenses: fs.expenses ?? summary.expenses,
            expensesTotal: fs.expensesTotal ?? summary.expensesTotal,
        };
    }, [isClosed, investment, summary]);

    const snapMiGanancia = useMemo(() => {
        if (!isClosed || !exportSummary) return miGanancia;
        if (miGanancia == null) return null;
        if (!profile) return miGanancia;
        const rows = exportSummary.rows;
        const snapExpenses = exportSummary.expenses ?? [];
        if (isSuperAdmin) {
            const givenAway = rows.reduce((acc, row) => {
                const user = myUsers.find((u) => u.id === row.userId);
                const totalPct = (user?.sharedWith ?? []).reduce((s, sw) => s + sw.percentage, 0);
                return acc + (row.real * totalPct / 100);
            }, 0);
            const expensesTotal = exportSummary.expensesTotal ?? 0;
            const superadminExpenseShare = getExpenseShareFor(snapExpenses, profile.id, true);
            return exportSummary.real - givenAway + (expensesTotal - superadminExpenseShare);
        }
        const revenueShare = rows.reduce((acc, row) => {
            const user = myUsers.find((u) => u.id === row.userId);
            const share = user?.sharedWith?.find((s) => s.adminId === profile.id);
            if (!share) return acc;
            return acc + (row.real * share.percentage / 100);
        }, 0);
        const adminExpenseShare = getExpenseShareFor(snapExpenses, profile.id, false);
        return revenueShare - adminExpenseShare;
    }, [isClosed, exportSummary, miGanancia, profile, isSuperAdmin, myUsers]);

    async function toggleSubscriptionPayment(user: UserDoc) {
        if (isClosed) {
            setErr("La semana esta cerrada. Reabre la semana para editar pagos.");
            return;
        }

        if (user.billingMode !== "weekly_subscription") return;

        const currentPaid = user.weeklySubscriptionWeeks?.[week.startKey]?.paid === true;
        const nextPaid = !currentPaid;
        const amount = user.weeklySubscriptionWeeks?.[week.startKey]?.amount
            ?? user.weeklySubscriptionAmount
            ?? 0;
        const cost = user.weeklySubscriptionWeeks?.[week.startKey]?.cost
            ?? user.weeklySubscriptionCost
            ?? 0;

        setErr(null);

        try {
            await updateWeeklySubscriptionPayment({
                userId: user.id,
                weekStartKey: week.startKey,
                paid: nextPaid,
                amount,
                cost,
                updatedBy: firebaseUser?.uid ?? null,
            });

            setUsers((prev) =>
                prev.map((item) =>
                    item.id === user.id
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
        const closingSummary = adjustedCloseSummary;
        if (!closingSummary) return;

        setErr(null);
        setSavingWeek(true);

        try {
            const next = await closeWeeklyInvestment({
                weekStartKey: week.startKey,
                weekEndKey: week.endKey,
                summary: closingSummary,
                expenses,
                closedBy: firebaseUser?.uid ?? null,
            });
            setInvestment(next);
            setCloseOpen(false);
            setExcludedUserIds([]);
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo cerrar la semana.");
        } finally {
            setSavingWeek(false);
        }
    }

    function handlePatchEvents(patches: { id: string; rateApplied: number; amount: number }[]) {
        setEvents((prev) =>
            prev.map((event) => {
                const patch = patches.find((p) => p.id === event.id);
                return patch ? { ...event, rateApplied: patch.rateApplied, amount: patch.amount } : event;
            })
        );
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

    if (!canAccounting) return (
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
                <MobileAccountingPage
                    period={period}
                    periodMode={periodMode}
                    periodOffset={periodOffset}
                    setPeriodMode={setPeriodMode}
                    setPeriodOffset={setPeriodOffset}
                    usersCount={myUsers.length}
                    eventsCount={scopedEvents.length}
                    loading={loading}
                    summary={summary}
                    events={scopedEvents}
                    assignments={scopedAssignments}
                    subscriptions={scopedSubscriptions}
                    startDate={period.startDate}
                    endDate={period.endDate}
                    users={myUsers}
                    investment={myInvestment}
                    investmentGroups={myInvestmentGroups}
                    weekStatus={weekStatus}
                    isClosed={isClosed}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    onRefresh={() => setRefreshNonce((value) => value + 1)}
                    onDownload={() => setDownloadOpen(true)}
                    onCloseWeek={() => { setExcludedUserIds([]); setCloseOpen(true); }}
                    onReopenWeek={() => setReopenOpen(true)}
                    savingWeek={savingWeek}
                    onInvestmentSaved={setInvestment}
                    onGroupsSaved={setInvestmentGroups}
                    onToggleSubscriptionPayment={toggleSubscriptionPayment}
                    onPatchEvents={handlePatchEvents}
                    onError={setErr}
                    miGanancia={miGanancia}
                    isSuperAdmin={isSuperAdmin}
                />
            </div>

            <div className="hidden xl:block">
                <PageHeader
                    title="Contabilidad"
                    subtitle="Control de ingresos, inversion, suscripciones y resultado real."
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
                                        label="Descargar"
                                        variant="primary"
                                        onClick={() => setDownloadOpen(true)}
                                    />
                                ) : null}
                                {canInvestmentView && periodMode === "weekly" ? (
                                    <IconButton
                                        icon="wallet"
                                        label="Configurar inversion"
                                        variant="primary"
                                        onClick={() => setActiveTab("investment")}
                                    />
                                ) : null}
                                {isSuperAdmin && periodMode === "weekly" ? (
                                    isClosed ? (
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
                                            onClick={() => { setExcludedUserIds([]); setCloseOpen(true); }}
                                            disabled={savingWeek || !summary}
                                        />
                                    )
                                ) : null}
                                <IconButton
                                    icon="refresh"
                                    label="Actualizar"
                                    variant="primary"
                                    onClick={() => setRefreshNonce((value) => value + 1)}
                                    disabled={loading}
                                />
                            </div>
                            {periodMode === "weekly" ? <StatusPill status={weekStatus} /> : <Badge tone="blue">Vista mensual</Badge>}
                        </div>
                    }
                />

                <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#e4e7ec] bg-white px-3 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                    <div className="grid grid-cols-[40px_1fr_40px] items-center gap-2 sm:flex sm:flex-wrap">
                        <div className="col-span-3 grid grid-cols-2 gap-1 rounded-xl border border-[#e4e7ec] bg-[#f9fafb] p-1 sm:col-span-1">
                            <button
                                type="button"
                                onClick={() => setPeriodMode("weekly")}
                                className={`h-8 rounded-lg px-3 text-[11px] font-black ${periodMode === "weekly" ? "bg-white text-[#6d28d9] shadow-sm" : "text-[#667085]"}`}
                            >
                                Semanal
                            </button>
                            <button
                                type="button"
                                onClick={() => setPeriodMode("monthly")}
                                className={`h-8 rounded-lg px-3 text-[11px] font-black ${periodMode === "monthly" ? "bg-white text-[#6d28d9] shadow-sm" : "text-[#667085]"}`}
                            >
                                Mensual
                            </button>
                        </div>
                        <IconButton
                            icon="arrowLeft"
                            label={periodMode === "monthly" ? "Mes anterior" : "Semana anterior"}
                            onClick={() => setPeriodOffset((v) => v - 1)}
                        />
                        <div className="flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl border border-[#e4e7ec] bg-[#f9fafb] px-2 text-[11px] font-bold text-[#344054] sm:h-9 sm:justify-start sm:rounded-md sm:px-3 sm:text-[12px]">
                            <Icon name="calendar" />
                            <span className="truncate">{period.startKey}</span>
                            <span className="text-[#98a2b3]">/</span>
                            <span className="truncate">{period.endKey}</span>
                        </div>
                        <IconButton
                            icon="arrowRight"
                            label={periodMode === "monthly" ? "Mes siguiente" : "Semana siguiente"}
                            onClick={() => setPeriodOffset((v) => v + 1)}
                        />
                        {periodOffset !== 0 ? (
                            <Button onClick={() => setPeriodOffset(0)} className="col-span-3 sm:col-span-1">
                                Actual
                            </Button>
                        ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                        <CounterPill icon="users" label={`${myUsers.length} usuarios`} />
                        <CounterPill icon="activity" label={`${scopedEvents.length} eventos`} />
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
                                miGanancia={miGanancia}
                                adminUsers={adminUsers}
                                sellers={myUsers}
                                isSuperAdmin={isSuperAdmin}
                                profile={profile}
                                weekStartKey={week.startKey}
                                weekEndKey={week.endKey}
                            />
                        ) : null}

                        {activeTab === "overview" || !canInvestmentView ? (
                            <DashboardContent
                                summary={summary}
                                events={scopedEvents}
                                assignments={scopedAssignments}
                                startDate={period.startDate}
                                endDate={period.endDate}
                                users={myUsers}
                                miGanancia={miGanancia}
                                isSuperAdmin={isSuperAdmin}
                                exportSummary={exportSummary}
                                snapMiGanancia={snapMiGanancia}
                                expenses={expenses}
                                onDownload={() => setDownloadOpen(true)}
                            />
                        ) : (
                            <InvestmentContent
                                weekStartKey={week.startKey}
                                weekEndKey={week.endKey}
                                users={myUsers}
                                subscriptions={scopedSubscriptions}
                                investment={myInvestment}
                                investmentGroups={myInvestmentGroups}
                                useCatalogDefaults={weekOffset === 0}
                                isClosed={isClosed || !canInvestmentEdit}
                                isSuperAdmin={isSuperAdmin}
                                events={scopedEvents}
                                onToggleSubscriptionPayment={toggleSubscriptionPayment}
                                onPatchEvents={handlePatchEvents}
                                onSaved={(next) => {
                                    setInvestment(next);
                                }}
                                onGroupsSaved={setInvestmentGroups}
                                onError={setErr}
                            />
                        )}
                    </div>
                )}
            </div>
            <Modal
                open={closeOpen}
                onClose={() => setCloseOpen(false)}
                title="Cerrar semana"
                subtitle={`${week.startKey} a ${week.endKey}`}
                size="lg"
            >
                <div className="space-y-4">
                    <div className="grid gap-3 rounded-lg border border-[#e4e7ec] bg-[#f9fafb] p-3 sm:grid-cols-4">
                        <MiniInvestmentStat label="Bruta" value={money(adjustedCloseSummary?.gross ?? 0)} />
                        <MiniInvestmentStat label="Inversion" value={money(adjustedCloseSummary?.investment ?? 0)} />
                        <MiniInvestmentStat label="Gastos" value={money(adjustedCloseSummary?.expensesTotal ?? 0)} />
                        <MiniInvestmentStat label="Real" value={money(adjustedCloseSummary?.real ?? 0)} tone={((adjustedCloseSummary?.real ?? 0) >= 0) ? "green" : "red"} />
                    </div>

                    {summary ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
                                <div className="mb-2 text-[12px] font-black text-[#101936]">Inversion incluida</div>
                                <div className="space-y-1.5 text-[12px] font-semibold">
                                    {summary.groupInvestment > 0 ? (
                                        <div className="flex justify-between gap-3"><span className="text-[#667085]">Grupos de inversion</span><span className="font-black text-[#172033]">{money(summary.groupInvestment)}</span></div>
                                    ) : null}
                                    {summary.subscriptionInvestment > 0 ? (
                                        <div className="flex justify-between gap-3"><span className="text-[#667085]">Inversion suscripciones</span><span className="font-black text-[#172033]">{money(summary.subscriptionInvestment)}</span></div>
                                    ) : null}
                                    {summary.manualAdjustment > 0 ? (
                                        <div className="flex justify-between gap-3"><span className="text-[#667085]">Ajuste manual</span><span className="font-black text-[#172033]">{money(summary.manualAdjustment)}</span></div>
                                    ) : null}
                                    {summary.groupInvestment <= 0 && summary.subscriptionInvestment <= 0 && summary.manualAdjustment <= 0 ? (
                                        <span className="text-[#98a2b3]">Sin inversiones adicionales.</span>
                                    ) : null}
                                </div>
                            </div>
                            <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
                                <div className="mb-2 text-[12px] font-black text-[#101936]">Por cliente visitado</div>
                                <div className="space-y-1.5 text-[12px] font-semibold">
                                    {summary.rows.filter((row) => row.billingMode === "per_visit" && row.visited > 0).slice(0, 5).map((row) => (
                                        <div key={row.userId} className="flex justify-between gap-3">
                                            <span className="min-w-0 truncate text-[#667085]">{row.name}</span>
                                            <span className="shrink-0 font-black text-[#172033]">{row.visited} visitas · {money(row.gross)}</span>
                                        </div>
                                    ))}
                                    {summary.rows.filter((row) => row.billingMode === "per_visit" && row.visited > 0).length === 0 ? (
                                        <span className="text-[#98a2b3]">Sin usuarios por visita en este cierre.</span>
                                    ) : null}
                                </div>
                            </div>

                            {expenses.length > 0 ? (
                                <div className="rounded-lg border border-red-100 bg-red-50 p-3 sm:col-span-2">
                                    <div className="mb-2 text-[12px] font-black text-red-700">Gastos de mantenimiento</div>
                                    <div className="space-y-1 text-[12px] font-semibold">
                                        {expenses.map((expense) => (
                                            <div key={expense.id} className="flex justify-between gap-3">
                                                <span className="min-w-0 truncate text-[#667085]">{expense.name}</span>
                                                <span className="shrink-0 font-black text-[#172033]">{money(expense.amount)}</span>
                                            </div>
                                        ))}
                                        <div className="mt-1.5 flex justify-between gap-3 border-t border-red-100 pt-1.5">
                                            <span className="font-black text-red-700">Total gastos</span>
                                            <span className="font-black text-red-700">{money(summary.expensesTotal ?? 0)}</span>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            {(() => {
                                const expTotal = summary.expensesTotal ?? 0;
                                if (expTotal === 0) return null;
                                const hasAllocations = expenses.some((e) => e.allocations && e.allocations.length > 0);
                                if (!hasAllocations) return null;
                                const participantMap = new Map<string, { name: string; amount: number }>();
                                for (const e of expenses) {
                                    if (!e.allocations || e.allocations.length === 0) {
                                        const prev = participantMap.get("__superadmin__") ?? { name: profile?.name || "Superadmin", amount: 0 };
                                        participantMap.set("__superadmin__", { ...prev, amount: prev.amount + e.amount });
                                    } else {
                                        for (const alloc of e.allocations) {
                                            const key = alloc.userId === profile?.id ? "__superadmin__" : alloc.userId;
                                            const prev = participantMap.get(key) ?? { name: alloc.name, amount: 0 };
                                            participantMap.set(key, { name: prev.name || alloc.name, amount: prev.amount + e.amount * alloc.percentage / 100 });
                                        }
                                    }
                                }
                                const entries = Array.from(participantMap.entries())
                                    .filter(([, v]) => v.amount > 0)
                                    .sort(([a], [b]) => (a === "__superadmin__" ? -1 : b === "__superadmin__" ? 1 : 0));
                                if (!entries.length) return null;
                                return (
                                    <div className="rounded-lg border border-[#e4e7ec] bg-white p-3 sm:col-span-2">
                                        <div className="mb-2 text-[12px] font-black text-[#101936]">Participacion en gastos</div>
                                        <div className="space-y-1.5 text-[12px] font-semibold">
                                            {entries.map(([key, { name, amount }]) => (
                                                <div key={key} className="flex justify-between gap-3">
                                                    <span className="min-w-0 truncate text-[#667085]">{key === "__superadmin__" ? (profile?.name || "Superadmin") : name}</span>
                                                    <span className="shrink-0 font-black text-[#172033]">{Math.round(amount / expTotal * 100)}% · {money(Math.round(amount * 100) / 100)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}

                            {isSuperAdmin && (closeMiGananciaPerAdmin.length > 0 || closeMiGanancia != null) ? (
                                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 sm:col-span-2">
                                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.08em] text-emerald-700">Ganancias de socios</div>
                                    <div className="space-y-2">
                                        {closeMiGanancia != null ? (
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-[13px] font-bold text-emerald-800">Mi ganancia</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[13px] font-black text-emerald-700">{money(closeMiGanancia)}</span>
                                                    <button
                                                        type="button"
                                                        title="Descargar recibo"
                                                        className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-600 transition hover:bg-emerald-100"
                                                        onClick={() => adjustedCloseSummary && closeMiGanancia != null && downloadReceiptAsImage({
                                                            adminName: profile?.name || profile?.email || "SuperAdmin",
                                                            weekStartKey: week.startKey,
                                                            weekEndKey: week.endKey,
                                                            gross: adjustedCloseSummary.gross,
                                                            subscriptionInvestment: adjustedCloseSummary.subscriptionInvestment,
                                                            real: adjustedCloseSummary.real,
                                                            expensesTotal: adjustedCloseSummary.expensesTotal ?? 0,
                                                            miGanancia: closeMiGanancia,
                                                        })}
                                                    >
                                                        <Icon name="download" />
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null}
                                        {closeMiGananciaPerAdmin.map(({ admin, gain }) => (
                                            <div key={admin.id} className="flex items-center justify-between gap-3">
                                                <span className="min-w-0 truncate text-[12px] font-semibold text-emerald-700">{admin.name || admin.email || admin.id}</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] font-black text-emerald-700">{money(gain)}</span>
                                                    <button
                                                        type="button"
                                                        title="Descargar recibo"
                                                        className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-600 transition hover:bg-emerald-100"
                                                        onClick={() => adjustedCloseSummary && downloadReceiptAsImage({
                                                            adminName: admin.name || admin.email || admin.id,
                                                            weekStartKey: week.startKey,
                                                            weekEndKey: week.endKey,
                                                            gross: adjustedCloseSummary.gross,
                                                            subscriptionInvestment: adjustedCloseSummary.subscriptionInvestment,
                                                            real: adjustedCloseSummary.real,
                                                            expensesTotal: adjustedCloseSummary.expensesTotal ?? 0,
                                                            miGanancia: gain,
                                                        })}
                                                    >
                                                        <Icon name="download" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : closeMiGanancia != null ? (
                                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 sm:col-span-2">
                                    <div className="text-[11px] font-black uppercase tracking-[0.08em] text-emerald-700">Mi ganancia</div>
                                    <div className="mt-1 text-[18px] font-black text-emerald-700">{money(closeMiGanancia)}</div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {summary ? (() => {
                        const subsRows = summary.rows.filter((row) =>
                            row.billingMode === "weekly_subscription" && row.subscriptionPaid === true
                        );
                        if (!subsRows.length) return null;
                        return (
                            <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
                                <div className="mb-1 text-[12px] font-black text-[#101936]">Ajuste de suscripciones</div>
                                <p className="mb-2.5 text-[11px] font-semibold text-[#98a2b3]">Desmarca las que no quieres incluir en este cierre. Puedes revertirlo reabriendo la semana.</p>
                                <div className="space-y-1.5">
                                    {subsRows.map((row) => {
                                        const excluded = excludedUserIds.includes(row.userId);
                                        return (
                                            <button
                                                key={row.userId}
                                                type="button"
                                                onClick={() => setExcludedUserIds((prev) =>
                                                    prev.includes(row.userId)
                                                        ? prev.filter((id) => id !== row.userId)
                                                        : [...prev, row.userId]
                                                )}
                                                className={[
                                                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition",
                                                    excluded
                                                        ? "border-red-200 bg-red-50 opacity-60"
                                                        : "border-[#e4e7ec] bg-[#f9fafb] hover:bg-[#f0edff]",
                                                ].join(" ")}
                                            >
                                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-black ${excluded ? "border-red-300 bg-white text-red-400" : "border-[#7C3AED] bg-[#7C3AED] text-white"}`}>
                                                    {excluded ? "✕" : "✓"}
                                                </span>
                                                <span className={`min-w-0 flex-1 truncate text-[12px] font-bold ${excluded ? "text-[#98a2b3] line-through" : "text-[#172033]"}`}>
                                                    {row.name}
                                                </span>
                                                <span className="shrink-0 text-[11px] font-semibold text-[#667085]">
                                                    {row.subscriptionSource === "real" ? "Real" : "Manual"}
                                                </span>
                                                <span className={`shrink-0 text-[12px] font-black ${excluded ? "text-[#98a2b3]" : row.real >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                                    {money(row.real)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {excludedUserIds.length > 0 ? (
                                    <div className="mt-2 flex items-center justify-between rounded-lg bg-[#f0edff] px-3 py-1.5 text-[11px] font-semibold text-[#7C3AED]">
                                        <span>{excludedUserIds.length} excluida{excludedUserIds.length !== 1 ? "s" : ""} del cierre</span>
                                        <button type="button" className="font-black hover:underline" onClick={() => setExcludedUserIds([])}>Restablecer</button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })() : null}

                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
                        Al cerrar la semana se guarda un snapshot final y se bloquean pagos, grupos y ajustes hasta reabrirla.
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <button
                            type="button"
                            onClick={() => setCloseDownloadOpen(true)}
                            disabled={!adjustedCloseSummary}
                            className="flex h-9 items-center gap-2 rounded-xl border border-[#d9d2ff] bg-white px-3 text-[12px] font-bold text-[#4f46e5] shadow-sm transition hover:bg-[#f3f0ff] disabled:opacity-40"
                        >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                            </svg>
                            Descargar
                        </button>
                        <div className="flex flex-col-reverse gap-2 sm:flex-row">
                            <Button
                                variant="ghost"
                                onClick={() => setCloseOpen(false)}
                                disabled={savingWeek}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleCloseWeek}
                                disabled={savingWeek || !summary}
                            >
                                {savingWeek ? "Cerrando..." : "Cerrar semana"}
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
            <DownloadSheet
                open={closeDownloadOpen}
                onClose={() => setCloseDownloadOpen(false)}
                onExcel={() => adjustedCloseSummary && exportAccountingSheet(adjustedCloseSummary, closeMiGanancia, isSuperAdmin, expenses)}
                receipts={[
                    ...(closeMiGanancia != null && profile ? [{
                        label: isSuperAdmin ? (profile.name || "Superadmin") : (profile.name || profile.email || "Admin"),
                        onClick: () => adjustedCloseSummary && downloadReceiptAsImage({
                            adminName: profile.name || profile.email || "Admin",
                            weekStartKey: week.startKey,
                            weekEndKey: week.endKey,
                            gross: adjustedCloseSummary.gross,
                            subscriptionInvestment: adjustedCloseSummary.subscriptionInvestment,
                            real: adjustedCloseSummary.real,
                            expensesTotal: adjustedCloseSummary.expensesTotal ?? 0,
                            expenses,
                            miGanancia: closeMiGanancia,
                        }),
                    }] : []),
                    ...closeMiGananciaPerAdmin.map(({ admin, gain }) => ({
                        label: admin.name || admin.email || admin.id,
                        onClick: () => adjustedCloseSummary && downloadReceiptAsImage({
                            adminName: admin.name || admin.email || admin.id,
                            weekStartKey: week.startKey,
                            weekEndKey: week.endKey,
                            gross: adjustedCloseSummary.gross,
                            subscriptionInvestment: adjustedCloseSummary.subscriptionInvestment,
                            real: adjustedCloseSummary.real,
                            expensesTotal: adjustedCloseSummary.expensesTotal ?? 0,
                            expenses,
                            miGanancia: gain,
                        }),
                    })),
                ]}
            />

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
                        <Button
                            variant="ghost"
                            onClick={() => setReopenOpen(false)}
                            disabled={savingWeek}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="danger"
                            onClick={handleReopenWeek}
                            disabled={savingWeek || !investment}
                        >
                            {savingWeek ? "Reabriendo..." : "Reabrir semana"}
                        </Button>
                    </div>
                </div>
            </Modal>
            <DownloadSheet
                open={downloadOpen}
                onClose={() => setDownloadOpen(false)}
                onExcel={() => exportAccountingSheet(exportSummary ?? summary, snapMiGanancia, isSuperAdmin, expenses)}
                receipts={[
                    ...(snapMiGanancia != null && profile ? [{
                        label: isSuperAdmin ? (profile.name || "Superadmin") : (profile.name || profile.email || "Admin"),
                        onClick: () => summary && downloadReceiptAsImage({
                            adminName: profile.name || profile.email || "Admin",
                            weekStartKey: week.startKey,
                            weekEndKey: week.endKey,
                            gross: (exportSummary ?? summary).gross,
                            subscriptionInvestment: (exportSummary ?? summary).subscriptionInvestment,
                            real: (exportSummary ?? summary).real,
                            expensesTotal: (exportSummary ?? summary).expensesTotal ?? 0,
                            expenses,
                            miGanancia: snapMiGanancia,
                        }),
                    }] : []),
                    ...miGananciaPerAdmin.map(({ admin, gain }) => ({
                        label: admin.name || admin.email || admin.id,
                        onClick: () => summary && downloadReceiptAsImage({
                            adminName: admin.name || admin.email || admin.id,
                            weekStartKey: week.startKey,
                            weekEndKey: week.endKey,
                            gross: (exportSummary ?? summary).gross,
                            subscriptionInvestment: (exportSummary ?? summary).subscriptionInvestment,
                            real: (exportSummary ?? summary).real,
                            expensesTotal: (exportSummary ?? summary).expensesTotal ?? 0,
                            expenses,
                            miGanancia: gain,
                        }),
                    })),
                ]}
            />
        </div>
    );
}
function MobileAccountingPage({
    period,
    periodMode,
    periodOffset,
    setPeriodMode,
    setPeriodOffset,
    usersCount,
    eventsCount,
    loading,
    summary,
    events,
    assignments,
    subscriptions,
    startDate,
    endDate,
    users,
    investment,
    investmentGroups,
    weekStatus,
    isClosed,
    activeTab,
    setActiveTab,
    onRefresh,
    onDownload,
    onCloseWeek,
    onReopenWeek,
    savingWeek,
    onInvestmentSaved,
    onGroupsSaved,
    onToggleSubscriptionPayment,
    onPatchEvents,
    onError,
    miGanancia,
    isSuperAdmin,
}: {
    period: ReturnType<typeof monthRange>;
    periodMode: AccountingPeriodMode;
    periodOffset: number;
    setPeriodMode: React.Dispatch<React.SetStateAction<AccountingPeriodMode>>;
    setPeriodOffset: React.Dispatch<React.SetStateAction<number>>;
    usersCount: number;
    eventsCount: number;
    loading: boolean;
    summary: AccountingSummary | null;
    events: DailyEventDoc[];
    assignments: AccountingAssignmentDoc[];
    subscriptions: AccountingSubscriptionDoc[];
    startDate: Date;
    endDate: Date;
    users: UserDoc[];
    investment: WeeklyInvestmentDoc | null;
    investmentGroups: InvestmentGroupDoc[];
    weekStatus: WeeklyInvestmentDoc["status"];
    isClosed: boolean;
    activeTab: AccountingTab;
    setActiveTab: (tab: AccountingTab) => void;
    onRefresh: () => void;
    onDownload?: () => void;
    onCloseWeek: () => void;
    onReopenWeek: () => void;
    savingWeek: boolean;
    onInvestmentSaved: (investment: WeeklyInvestmentDoc) => void;
    onGroupsSaved: (groups: InvestmentGroupDoc[]) => void;
    onToggleSubscriptionPayment: (user: UserDoc) => void;
    onPatchEvents: (patches: { id: string; rateApplied: number; amount: number }[]) => void;
    onError: (msg: string | null) => void;
    miGanancia?: number | null;
    isSuperAdmin?: boolean;
}) {
    const canInvestmentView = useCan("accountingInvestmentView");
    const canInvestmentEdit = useCan("accountingInvestmentEdit");
    const canClose = useCan("accountingClose");
    const [chartMetric, setChartMetric] = useState<AccountingMetric>("real");
    const [chartMode, setChartMode] = useState<ChartMode>("trend");
    const [rankingMetric, setRankingMetric] = useState<AccountingMetric>("real");
    const [usersOpen, setUsersOpen] = useState(false);
    const [eventsTooltipOpen, setEventsTooltipOpen] = useState(false);

    useEffect(() => {
        if (activeTab !== "investment") return;
        window.history.pushState({ investmentTab: true }, "");
        const handler = (e: PopStateEvent) => {
            if (!e.state?.investmentTab) setActiveTab("overview");
        };
        window.addEventListener("popstate", handler);
        return () => window.removeEventListener("popstate", handler);
    }, [activeTab, setActiveTab]);

    const real = summary?.real ?? 0;
    const gross = summary?.gross ?? 0;
    const investmentValue = summary?.investment ?? 0;
    const roi = summary?.roi ?? null;

    const activeRows = useMemo(() => {
        if (!summary) return [];
        return summary.rows.filter((row) =>
            row.assigned > 0 || row.visited > 0 || row.rejected > 0 || Math.abs(row.real) > 0
        );
    }, [summary]);

    const rankedRows = useMemo(() => {
        return [...activeRows].sort((a, b) =>
            accountingMetricValue(b, rankingMetric) - accountingMetricValue(a, rankingMetric)
        );
    }, [activeRows, rankingMetric]);

    const chartRows = useMemo(() => {
        return [...activeRows]
            .sort((a, b) => Math.abs(accountingMetricValue(b, chartMetric)) - Math.abs(accountingMetricValue(a, chartMetric)))
            .slice(0, 8);
    }, [activeRows, chartMetric]);

    const maxChartValue = Math.max(1, ...chartRows.map((row) => Math.abs(accountingMetricValue(row, chartMetric))));

    const userRatesMap = useMemo(() => {
        const map = new Map<string, number>();
        for (const user of users) {
            if (user.ratePerVisit != null) map.set(user.id, user.ratePerVisit);
        }
        return map;
    }, [users]);

    const chartSeries = useMemo(() => {
        return buildDailyChartSeries(events, assignments, startDate, endDate, chartMetric, userRatesMap);
    }, [events, assignments, startDate, endDate, chartMetric, userRatesMap]);

    const chartMeta = ACCOUNTING_METRICS[chartMetric];
    const rankingMeta = ACCOUNTING_METRICS[rankingMetric];

    return (
        <div className="-mx-3 -mt-4 min-h-[calc(100vh-5.5rem)] max-w-[100vw] bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)] pb-6 text-[#101936]">

            {/* STICKY HEADER */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-3 backdrop-blur-md">

                {/* TITLE ROW */}
                <div className="mb-3 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                            Contabilidad
                        </h1>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                            {period.startKey} · {period.endKey}
                            {" · "}
                            {periodMode === "weekly" ? <MobileStatusPill status={weekStatus} inline /> : "Vista mensual"}
                        </p>
                    </div>

                    {onDownload ? (
                        <MobileAccountingIconButton icon="download" label="Descargar" onClick={() => onDownload()} />
                    ) : null}

                    {canInvestmentView && periodMode === "weekly" ? (
                        <MobileAccountingIconButton
                            icon="wallet"
                            label="Inversión"
                            active={activeTab === "investment"}
                            onClick={() => setActiveTab(activeTab === "investment" ? "overview" : "investment")}
                        />
                    ) : null}

                    {isSuperAdmin && periodMode === "weekly" ? (
                        <MobileAccountingIconButton
                            icon={isClosed ? "unlock" : "lock"}
                            label={isClosed ? "Reabrir" : "Cerrar"}
                            disabled={savingWeek || (!summary && !isClosed)}
                            active={isClosed}
                            onClick={isClosed ? onReopenWeek : onCloseWeek}
                        />
                    ) : null}

                    <MobileAccountingIconButton
                        icon="refresh"
                        label="Actualizar"
                        disabled={loading}
                        onClick={onRefresh}
                    />
                </div>

                {/* WEEK NAVIGATION */}
                <div className="flex items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-2 py-2 shadow-sm">
                    <button
                        type="button"
                        onClick={() => setPeriodOffset((v) => v - 1)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] text-[#7C3AED] transition active:bg-[#f3f0ff]"
                    >
                        <MobileAccountingIcon name="arrowLeft" />
                    </button>

                    <div className="min-w-0 flex-1 text-center">
                        <div className="truncate text-[11px] font-black text-[#101936]">
                            {period.startKey} · {period.endKey}
                        </div>
                        <div className="mt-0.5 text-[10px] font-semibold text-[#66739A]">
                            {periodMode === "monthly"
                                ? periodOffset === 0 ? "Mes actual" : "Mes historico"
                                : periodOffset === 0 ? "Semana actual" : "Semana historica"}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setPeriodOffset((v) => v + 1)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] text-[#7C3AED] transition active:bg-[#f3f0ff]"
                    >
                        <MobileAccountingIcon name="arrowRight" />
                    </button>

                    {periodOffset !== 0 ? (
                        <button
                            type="button"
                            onClick={() => setPeriodOffset(0)}
                            className="h-9 rounded-[12px] border border-violet-200 bg-violet-50 px-3 text-[11px] font-black text-[#7C3AED] transition active:bg-violet-100"
                        >
                            Actual
                        </button>
                    ) : null}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1 rounded-[14px] border border-[#E8E7FB] bg-white p-1 shadow-sm">
                    <button
                        type="button"
                        onClick={() => setPeriodMode("weekly")}
                        className={`h-8 rounded-[10px] text-[11px] font-black ${periodMode === "weekly" ? "bg-[#f3f0ff] text-[#6d28d9]" : "text-[#66739A]"}`}
                    >
                        Semanal
                    </button>
                    <button
                        type="button"
                        onClick={() => setPeriodMode("monthly")}
                        className={`h-8 rounded-[10px] text-[11px] font-black ${periodMode === "monthly" ? "bg-[#f3f0ff] text-[#6d28d9]" : "text-[#66739A]"}`}
                    >
                        Mensual
                    </button>
                </div>

                {/* QUICK PILLS */}
                <div className="mt-2 flex gap-2">
                    <MobileAccountingPill icon="users" label={`${usersCount} usuarios`} />
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setEventsTooltipOpen((v) => !v)}
                            className="focus:outline-none"
                        >
                            <MobileAccountingPill icon="activity" label={`${eventsCount} eventos`} />
                        </button>
                        {eventsTooltipOpen ? (
                            <>
                                <button
                                    type="button"
                                    className="fixed inset-0 z-30"
                                    aria-label="Cerrar"
                                    onClick={() => setEventsTooltipOpen(false)}
                                />
                                <div className="absolute right-0 top-full z-40 mt-2 w-[min(16rem,calc(100vw-1.5rem))] rounded-[14px] border border-[#E8E7FB] bg-white p-3 shadow-[0_8px_30px_rgba(91,33,255,0.12)]">
                                    <p className="text-[12px] font-bold text-[#101936]">¿Qué son los eventos?</p>
                                    <p className="mt-1 text-[11px] font-medium leading-relaxed text-[#66739A]">
                                        Conteo de acciones registradas por los usuarios: <span className="font-bold text-emerald-600">Visitado</span>, <span className="font-bold text-red-500">Rechazado</span> y <span className="font-bold text-amber-600">Pendiente</span>. Cada vez que un usuario marca un prospecto con uno de estos estados, se genera un evento.
                                    </p>
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* CONTENT */}
            <div className="px-3 pt-3">
                {loading || !summary ? (
                    <div className="mt-10 flex flex-col items-center gap-3 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                            <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                            </svg>
                        </div>
                        <p className="text-[13px] font-semibold text-[#66739A]">Cargando contabilidad</p>
                    </div>
                ) : activeTab === "investment" && canInvestmentView ? (
                    <div className="rounded-[16px] border border-[#E8E7FB] bg-white shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
                        <div className="flex items-center justify-between border-b border-[#E8E7FB] px-3 py-3">
                            <div>
                                <div className="text-[13px] font-black text-[#101936]">Configuración de inversión</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab("overview")}
                                className="rounded-[10px] border border-[#E8E7FB] bg-white px-3 py-1.5 text-[11px] font-bold text-[#66739A] transition active:bg-[#f3f0ff]"
                            >
                                ← Volver
                            </button>
                        </div>
                        <div className="p-3">
                            <InvestmentContent
                                weekStartKey={period.startKey}
                                weekEndKey={period.endKey}
                                users={users}
                                subscriptions={subscriptions}
                                investment={investment}
                                investmentGroups={investmentGroups}
                                useCatalogDefaults={periodOffset === 0}
                                isClosed={isClosed || !canInvestmentEdit}
                                isSuperAdmin={isSuperAdmin}
                                events={events}
                                onToggleSubscriptionPayment={onToggleSubscriptionPayment}
                                onPatchEvents={onPatchEvents}
                                onSaved={onInvestmentSaved}
                                onGroupsSaved={onGroupsSaved}
                                onError={onError}
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        {/* MONEY CARDS */}
                        <div className="mb-3 grid grid-cols-2 gap-2">
                            <MobileMoneyCard
                                title="Ganancia real"
                                value={money(real)}
                                caption={`ROI ${formatPercent(roi)}`}
                                tone={real >= 0 ? "green" : "red"}
                                icon="cash"
                            />
                            <MobileMoneyCard
                                title="Ganancia bruta"
                                value={money(gross)}
                                caption="Visitas + suscripciones"
                                tone="blue"
                                icon="chart"
                            />
                        </div>

                        {/* WEEKLY RESULT BREAKDOWN */}
                        <div className="mb-3 rounded-[16px] border border-[#E8E7FB] bg-white p-3 shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
                            <div className="mb-3">
                                <div className="text-[13px] font-black text-[#101936]">Resultado semanal</div>
                                <div className="mt-0.5 text-[11px] font-semibold text-[#66739A]">Bruta menos inversión</div>
                            </div>
                            <div className={`mb-3 grid gap-2 ${miGanancia != null ? "grid-cols-3" : "grid-cols-2"}`}>
                                <MobileTinyMetric label="Inversión" value={money(investmentValue)} tone="amber" />
                                <MobileTinyMetric label="Real total" value={money(real)} tone={real >= 0 ? "green" : "red"} />
                                {miGanancia != null ? (
                                    <MobileTinyMetric label="Mi ganancia" value={money(miGanancia)} tone={miGanancia >= 0 ? "green" : "red"} />
                                ) : null}
                            </div>

                            {/* CHART CONTROLS */}
                            <div className="mb-2 flex gap-2">
                                <select
                                    value={chartMetric}
                                    onChange={(e) => setChartMetric(e.target.value as AccountingMetric)}
                                    className="h-9 min-w-0 flex-1 rounded-xl border border-[#e8e7fb] bg-[#f8f7ff] px-2 text-[11px] font-bold text-[#344054] outline-none"
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
                                    onChange={(e) => setChartMode(e.target.value as ChartMode)}
                                    className="h-9 min-w-0 flex-1 rounded-xl border border-[#e8e7fb] bg-[#f8f7ff] px-2 text-[11px] font-bold text-[#344054] outline-none"
                                >
                                    <option value="trend">Línea</option>
                                    <option value="bars">Barras</option>
                                    <option value="share">Participación</option>
                                </select>
                            </div>

                            <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a93ad] mb-1">
                                {chartMeta.label}
                            </div>
                            <AccountingChart
                                rows={chartRows}
                                series={chartSeries}
                                metric={chartMetric}
                                mode={chartMode}
                                maxValue={maxChartValue}
                            />

                        </div>

                        {/* ACTIVITY STATS */}
                        <div className="mb-3 grid grid-cols-3 gap-2">
                            <MobileStatBox label="Asig." value={summary.assigned} icon="users" tone="amber" />
                            <MobileStatBox label="Vis." value={summary.visited} icon="check" tone="green" />
                            <MobileStatBox label="Rech." value={summary.rejected} icon="close" tone="red" />
                        </div>

                        {/* RANKING */}
                        <div className="mb-3 overflow-hidden rounded-[16px] border border-[#E8E7FB] bg-white shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
                            <div className="flex items-center justify-between border-b border-[#E8E7FB] px-3 py-3">
                                <div>
                                    <div className="text-[13px] font-black text-[#101936]">Ranking</div>
                                    <div className="mt-0.5 text-[11px] font-semibold text-[#66739A]">Por {rankingMeta.label.toLowerCase()}</div>
                                </div>
                                <select
                                    value={rankingMetric}
                                    onChange={(e) => setRankingMetric(e.target.value as AccountingMetric)}
                                    className="h-8 rounded-xl border border-[#e8e7fb] bg-[#f8f7ff] px-2 text-[11px] font-bold text-[#344054] outline-none"
                                >
                                    <option value="real">Ganancia real</option>
                                    <option value="visited">Visitados</option>
                                    <option value="assigned">Asignados</option>
                                    <option value="rejected">Rechazados</option>
                                    <option value="gross">Bruta</option>
                                    <option value="cost">Costo</option>
                                </select>
                            </div>
                            <div className="divide-y divide-[#E8E7FB]">
                                {rankedRows.map((row, index) => (
                                    <div key={row.userId} className="flex items-center gap-3 px-3 py-2.5">
                                        <span className="w-5 shrink-0 text-center text-[11px] font-black text-[#98a2b3]">
                                            {index + 1}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-[#172033]">
                                            {row.name}
                                        </span>
                                        <span className={metricValueClass(rankingMetric, accountingMetricValue(row, rankingMetric))}>
                                            {rankingMeta.format(accountingMetricValue(row, rankingMetric))}
                                        </span>
                                    </div>
                                ))}
                                {rankedRows.length === 0 && (
                                    <div className="px-3 py-4 text-center text-[12px] font-semibold text-[#98a2b3]">
                                        Sin datos esta semana
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* USER LIST (optional via modal) */}
                        <button
                            type="button"
                            onClick={() => setUsersOpen(true)}
                            className="mb-3 flex h-12 w-full items-center justify-between rounded-[16px] border border-[#E8E7FB] bg-white px-3 shadow-[0_4px_18px_rgba(91,33,255,0.07)] active:bg-[#f8f7ff]"
                        >
                            <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-violet-50 text-[#7C3AED]">
                                    <MobileAccountingIcon name="users" />
                                </span>
                                <span className="text-[13px] font-black text-[#101936]">Detalle por usuario</span>
                            </div>
                            <span className="text-[11px] font-semibold text-[#7C3AED]">{activeRows.length} usuarios →</span>
                        </button>

                        {/* USERS MODAL */}
                        {usersOpen && (
                            <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101936]/25 backdrop-blur-md" onClick={() => setUsersOpen(false)}>
                                <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[#e8e7fb] bg-white shadow-[0_28px_80px_rgba(16,25,54,0.24)]" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex shrink-0 items-center justify-between border-b border-[#eef1f5] bg-gradient-to-r from-white to-[#f8f7ff] px-4 py-4">
                                        <div>
                                            <h2 className="text-[16px] font-black text-[#101936]">Usuarios</h2>
                                            <p className="mt-0.5 text-[12px] font-semibold text-[#66739a]">Resultado por usuario</p>
                                        </div>
                                        <button type="button" onClick={() => setUsersOpen(false)} className="rounded-full border border-[#e8e7fb] bg-white px-2 py-1 text-[20px] leading-none text-[#66739a]">×</button>
                                    </div>
                                    <div className="overflow-y-auto divide-y divide-[#E8E7FB]">
                                        {summary.rows
                                            .filter((row) => row.assigned > 0 || row.visited > 0 || row.rejected > 0 || Math.abs(row.real) > 0)
                                            .map((row) => (
                                                <MobileAccountingUserRow key={row.userId} row={row} />
                                            ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

        </div>
    );
}

function MobileAccountingIconButton({
    icon,
    label,
    onClick,
    active,
    disabled,
}: {
    icon: MobileAccountingIconName;
    label: string;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            className={[
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border shadow-sm transition disabled:opacity-50",
                active
                    ? "border-violet-200 bg-violet-50 text-[#7C3AED] active:bg-violet-100"
                    : "border-[#E8E7FB] bg-white text-[#66739A] active:bg-[#f3f0ff]",
            ].join(" ")}
        >
            <MobileAccountingIcon name={icon} />
        </button>
    );
}

function MobileAccountingPill({
    icon,
    label,
}: {
    icon: MobileAccountingIconName;
    label: string;
}) {
    return (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-[#E8E7FB] bg-white px-2 py-2 text-[11px] font-semibold text-[#66739A] shadow-sm">
            <span className="text-[#7C3AED]"><MobileAccountingIcon name={icon} /></span>
            <span className="truncate">{label}</span>
        </div>
    );
}

function MobileStatusPill({ status, inline }: { status: WeeklyInvestmentDoc["status"]; inline?: boolean }) {
    const label = status === "closed" ? "Cerrada" : status === "review" ? "Revisión" : "Abierta";

    const cls =
        status === "closed"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : status === "review"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-blue-200 bg-blue-50 text-blue-700";

    if (inline) {
        return (
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-black ${cls}`}>
                {label}
            </span>
        );
    }

    return (
        <div className={`flex flex-1 items-center justify-center rounded-[12px] border px-2 py-2 text-[11px] font-black ${cls}`}>
            {label}
        </div>
    );
}

function MobileMoneyCard({
    title,
    value,
    caption,
    tone,
    icon,
}: {
    title: string;
    value: string;
    caption: string;
    tone: "green" | "red" | "blue";
    icon: MobileAccountingIconName;
}) {
    const valueClass =
        tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-500" : "text-blue-600";

    const iconClass =
        tone === "green"
            ? "border-emerald-200 bg-emerald-50 text-emerald-600"
            : tone === "red"
                ? "border-red-200 bg-red-50 text-red-500"
                : "border-blue-200 bg-blue-50 text-blue-600";

    return (
        <div className="rounded-[16px] border border-[#E8E7FB] bg-white p-3 shadow-[0_4px_18px_rgba(91,33,255,0.07)]">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-[10px] border ${iconClass}`}>
                    <MobileAccountingIcon name={icon} />
                </div>
                <span className="rounded-full border border-[#E8E7FB] bg-[#f8f7ff] px-2 py-1 text-[9px] font-black text-[#66739A]">
                    SEMANA
                </span>
            </div>
            <div className="truncate text-[11px] font-semibold text-[#66739A]">{title}</div>
            <div className={`mt-1 truncate text-[17px] font-black ${valueClass}`}>{value}</div>
            <div className="mt-1 truncate text-[10px] font-medium text-[#98A2B3]">{caption}</div>
        </div>
    );
}

function MobileTinyMetric({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone: "green" | "red" | "amber" | "blue";
}) {
    const valueClass =
        tone === "green" ? "text-emerald-600"
        : tone === "red" ? "text-red-500"
        : tone === "amber" ? "text-amber-600"
        : "text-blue-600";

    return (
        <div className="rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-2 py-2">
            <div className="truncate text-[9px] font-black uppercase tracking-[0.06em] text-[#98A2B3]">{label}</div>
            <div className={`mt-1 truncate text-[12px] font-black ${valueClass}`}>{value}</div>
        </div>
    );
}

function MobileStatBox({
    label,
    value,
    icon,
    tone,
}: {
    label: string;
    value: number;
    icon: MobileAccountingIconName;
    tone: "green" | "red" | "amber";
}) {
    const colorClass =
        tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-500" : "text-amber-600";

    return (
        <div className="flex items-center justify-center gap-1.5 rounded-[14px] border border-[#E8E7FB] bg-white px-2 py-3 shadow-sm">
            <span className={colorClass}><MobileAccountingIcon name={icon} /></span>
            <span className="text-[14px] font-black text-[#101936]">{value}</span>
            <span className="truncate text-[9px] font-semibold text-[#66739A]">{label}</span>
        </div>
    );
}

function MobileAccountingUserRow({
    row,
}: {
    row: AccountingSummary["rows"][number];
}) {
    return (
        <div className="px-3 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-black text-[#101936]">{row.name}</div>
                    <div className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                        {row.subscriptionSource === "real"
                            ? "Suscripción pagada"
                            : row.billingMode === "weekly_subscription"
                                ? "Suscripción manual"
                                : "Por visita"}
                    </div>
                </div>
                <div className={[
                    "shrink-0 text-right text-[13px] font-black",
                    row.real >= 0 ? "text-emerald-600" : "text-red-500",
                ].join(" ")}>
                    {money(row.real)}
                </div>
            </div>
            <div className="mt-1.5 flex gap-3">
                <span className="text-[11px] font-semibold text-[#98A2B3]">Asig. <span className="font-black text-amber-600">{row.assigned}</span></span>
                <span className="text-[11px] font-semibold text-[#98A2B3]">Vis. <span className="font-black text-emerald-600">{row.visited}</span></span>
                <span className="text-[11px] font-semibold text-[#98A2B3]">Rech. <span className="font-black text-red-500">{row.rejected}</span></span>
            </div>
        </div>
    );
}

type MobileAccountingIconName =
    | "activity"
    | "arrowLeft"
    | "arrowRight"
    | "cash"
    | "chart"
    | "check"
    | "close"
    | "download"
    | "lock"
    | "refresh"
    | "unlock"
    | "users"
    | "wallet";

function MobileAccountingIcon({ name }: { name: MobileAccountingIconName }) {
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
            {name === "cash" ? <path {...common} d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12M16 14h5" /> : null}
            {name === "chart" ? <path {...common} d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7" /> : null}
            {name === "check" ? <path {...common} d="M20 6 9 17l-5-5" /> : null}
            {name === "close" ? <path {...common} d="M18 6 6 18M6 6l12 12" /> : null}
            {name === "download" ? <path {...common} d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" /> : null}
            {name === "lock" ? <path {...common} d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z" /> : null}
            {name === "unlock" ? <path {...common} d="M7 11V7a5 5 0 0 1 8.5-3.5M5 11h14v10H5z" /> : null}
            {name === "refresh" ? <path {...common} d="M21 12a9 9 0 0 1-15.4 6.4L3 16m0 5v-5h5M3 12a9 9 0 0 1 15.4-6.4L21 8m0-5v5h-5" /> : null}
            {name === "users" ? <path {...common} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.8" /> : null}
            {name === "wallet" ? <path {...common} d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12M16 14h5" /> : null}
        </svg>
    );
}
function InvestmentContent({
    weekStartKey,
    weekEndKey,
    users,
    subscriptions,
    investment,
    investmentGroups,
    useCatalogDefaults,
    isClosed,
    isSuperAdmin,
    events,
    onToggleSubscriptionPayment,
    onPatchEvents,
    onSaved,
    onGroupsSaved,
    onError,
}: {
    weekStartKey: string;
    weekEndKey: string;
    users: UserDoc[];
    subscriptions: AccountingSubscriptionDoc[];
    investment: WeeklyInvestmentDoc | null;
    investmentGroups: InvestmentGroupDoc[];
    useCatalogDefaults: boolean;
    isClosed: boolean;
    isSuperAdmin?: boolean;
    events: DailyEventDoc[];
    onToggleSubscriptionPayment: (user: UserDoc) => void;
    onPatchEvents: (patches: { id: string; rateApplied: number; amount: number }[]) => void;
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
    const [editingRatesUserId, setEditingRatesUserId] = useState<string | null>(null);
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
    const visibleUserIds = useMemo(() => new Set(users.map((user) => user.id)), [users]);
    const realSubscriptions = useMemo(
        () => subscriptions.filter((subscription) => visibleUserIds.has(subscription.userId)),
        [subscriptions, visibleUserIds]
    );
    const realSubscriptionsByUser = useMemo(
        () => summarizeSubscriptionsByUser(realSubscriptions),
        [realSubscriptions]
    );
    const subscriptionRows = useMemo(
        () => users.filter((user) => user.billingMode === "weekly_subscription" || realSubscriptionsByUser.has(user.id)),
        [users, realSubscriptionsByUser]
    );
    const paidSubscriptionRows = useMemo(
        () =>
            subscriptionRows.filter(
                (user) =>
                    realSubscriptionsByUser.has(user.id) ||
                    user.weeklySubscriptionWeeks?.[weekStartKey]?.paid === true
            ),
        [subscriptionRows, weekStartKey, realSubscriptionsByUser]
    );
    const subscriptionInvestment = paidSubscriptionRows.reduce(
        (sum, user) => {
            const real = realSubscriptionsByUser.get(user.id);
            if (real) return sum + real.cost;
            return sum + safeNumber(
                    user.weeklySubscriptionWeeks?.[weekStartKey]?.cost,
                    subscriptionCost(user)
                );
        },
        0
    );
    const perVisitUsersWithVisits = useMemo(() => {
        const visitedUserIds = new Set(events.filter((event) => event.type === "visited").map((event) => event.userId));
        return users.filter((user) =>
            user.billingMode !== "weekly_subscription" &&
            !realSubscriptionsByUser.has(user.id) &&
            visitedUserIds.has(user.id)
        );
    }, [events, users, realSubscriptionsByUser]);
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
            <Card className="overflow-hidden">
                <CardHeader
                    title="Inversion semanal"
                    subtitle={isClosed
                        ? (isSuperAdmin ? "Semana cerrada. Reabre para modificar inversion, grupos o pagos." : "Semana cerrada.")
                        : (isSuperAdmin ? "Suscripciones pagadas, grupos activos y ajustes manuales." : "Inversion por suscripciones pagadas.")}
                    action={isSuperAdmin && !isClosed ? (
                        <IconButton
                            icon="settings"
                            label="Configurar ajuste"
                            variant="primary"
                            onClick={() => setBudgetOpen(true)}
                        />
                    ) : undefined}
                />

                <div className="border-t border-[#eef1f5] p-4">
                    {isSuperAdmin ? (
                        <div className={`grid gap-x-6 gap-y-4 ${manualAdjustment > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
                            <div className="col-span-2 sm:col-span-1 border-b sm:border-b-0 sm:border-r border-[#eef1f5] pb-3 sm:pb-0 sm:pr-6">
                                <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#667085]">Total</div>
                                <div className="mt-1 text-[20px] font-black text-[#172033]">{money(totalInvestment)}</div>
                                <div className="mt-0.5 text-[10px] font-semibold text-[#98a2b3]">{weekStartKey} a {weekEndKey}</div>
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#667085]">Suscripciones</div>
                                <div className="mt-1 text-[15px] font-black text-[#172033]">{money(subscriptionInvestment)}</div>
                                <div className="mt-0.5 text-[10px] font-semibold text-[#98a2b3]">{paidSubscriptionRows.length} pagadas</div>
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#667085]">Grupos activos</div>
                                <div className="mt-1 text-[15px] font-black text-[#172033]">{money(assigned)}</div>
                                <div className="mt-0.5 text-[10px] font-semibold text-[#98a2b3]">{activeGroups.length} activos / {validGroups.length} guardados</div>
                            </div>
                            {manualAdjustment > 0 ? (
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#667085]">Ajuste manual</div>
                                    <div className="mt-1 text-[15px] font-black text-[#172033]">{money(manualAdjustment)}</div>
                                    <div className="mt-0.5 text-[10px] font-semibold text-[#98a2b3]">Ajuste adicional</div>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#667085]">Suscripciones</div>
                            <div className="mt-1 text-[20px] font-black text-[#172033]">{money(subscriptionInvestment)}</div>
                            <div className="mt-0.5 text-[10px] font-semibold text-[#98a2b3]">{paidSubscriptionRows.length} pagadas · {weekStartKey} a {weekEndKey}</div>
                        </div>
                    )}
                </div>
                {isSuperAdmin ? (
                    <div className="border-t border-[#eef1f5] px-4 py-3">
                        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[#667085]">
                            <span>Participacion de grupos en la inversion</span>
                            <span>{assignedPct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#eef1f5]">
                            <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: `${assignedPct}%` }} />
                        </div>
                    </div>
                ) : null}
            </Card>

            <Card className="overflow-hidden">
                <CardHeader
                    title="Suscripciones"
                    subtitle="Pagos reales del portal de suscripciones. Los controles manuales quedan como ajuste de soporte."
                />

                <div className="border-t border-[#eef1f5] p-4">
                    {subscriptionRows.length ? (
                        <div className="grid gap-2 xl:grid-cols-2">
                            {subscriptionRows.map((user) => {
                                const real = realSubscriptionsByUser.get(user.id);
                                const paid = Boolean(real) || user.weeklySubscriptionWeeks?.[weekStartKey]?.paid === true;
                                const weekAmount = real?.gross ?? user.weeklySubscriptionWeeks?.[weekStartKey]?.amount ?? subscriptionAmount(user);
                                const weekCost = real?.cost ?? user.weeklySubscriptionWeeks?.[weekStartKey]?.cost ?? subscriptionCost(user);
                                const sourceLabel = real
                                    ? `${real.count} pago${real.count === 1 ? "" : "s"} real${real.count === 1 ? "" : "es"}${real.cities.length ? ` · ${real.cities.join(", ")}` : ""}`
                                    : paid
                                        ? "Ajuste manual"
                                        : "Sin pago real";
                                return (
                                    <div
                                        key={user.id}
                                        className="grid gap-3 rounded-lg border border-[#e4e7ec] bg-white px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate text-[12px] font-semibold text-[#172033]">
                                                {user.name || user.email || user.id}
                                            </div>
                                            <div className="mt-0.5 text-[11px] font-medium text-[#667085]">
                                                Cuota {money(weekAmount)} / costo {money(weekCost)}
                                            </div>
                                            <div className="mt-0.5 truncate text-[10px] font-bold text-[#98a2b3]">
                                                {sourceLabel}
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 sm:justify-end">
                                            <Badge tone={real ? "green" : paid ? "yellow" : "yellow"}>
                                                {real ? "Pago real" : paid ? "Manual" : "Inactiva"}
                                            </Badge>
                                            <SubscriptionSwitch
                                                checked={paid}
                                                disabled={isClosed || Boolean(real)}
                                                onChange={() => onToggleSubscriptionPayment(user)}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-3 py-6 text-center text-[12px] font-semibold text-[#667085]">
                            No hay pagos reales ni ajustes manuales de suscripcion esta semana.
                        </div>
                    )}
                </div>
            </Card>

            {isSuperAdmin ? <Card className="overflow-hidden">
                <CardHeader
                    title="Tarifas por usuarios"
                    subtitle="Ajusta los valores aplicados a visitas de la semana. La contabilidad solo lee el resultado."
                />

                <div className="border-t border-[#eef1f5] p-4">
                    {perVisitUsersWithVisits.length ? (
                        <div className="grid gap-2 xl:grid-cols-2">
                            {perVisitUsersWithVisits.map((user) => {
                                const visited = events.filter((event) => event.userId === user.id && event.type === "visited");
                                const total = visited.reduce((sum, event) => sum + eventMoneyValue(event, user.ratePerVisit), 0);
                                return (
                                    <button
                                        key={user.id}
                                        type="button"
                                        onClick={() => setEditingRatesUserId(user.id)}
                                        disabled={isClosed}
                                        className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-lg border border-[#e4e7ec] bg-white px-3 py-2.5 text-left transition hover:bg-[#fbfaff] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <span className="truncate text-[12px] font-semibold text-[#172033]">
                                            {user.name || user.email || user.id}
                                        </span>
                                        <span className="whitespace-nowrap text-[11px] font-bold text-[#667085]">
                                            {visited.length} visitas
                                        </span>
                                        <span className="whitespace-nowrap text-[11px] font-black text-[#101936]">
                                            {money(total)}
                                        </span>
                                        <span className="whitespace-nowrap text-[11px] font-black text-[#7c3aed]">
                                            Editar
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-[#d0d5dd] bg-[#f9fafb] px-3 py-6 text-center text-[12px] font-semibold text-[#667085]">
                            No hay visitas por tarifa para ajustar esta semana.
                        </div>
                    )}
                </div>
            </Card> : null}

            {isSuperAdmin ? <Card>
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
            </Card> : null}

            {isSuperAdmin ? <Modal
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

                    <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-4">
                        <Button
                            variant="primary"
                            onClick={saveBudget}
                            disabled={saving || isClosed}
                        >
                            {saving ? "Guardando..." : "Guardar ajuste"}
                        </Button>
                    </div>
                </div>
            </Modal> : null}

            {isSuperAdmin && editingRatesUserId ? (
                <UserEventsModal
                    userId={editingRatesUserId}
                    userName={users.find((user) => user.id === editingRatesUserId)?.name ?? editingRatesUserId}
                    userRatePerVisit={users.find((user) => user.id === editingRatesUserId)?.ratePerVisit}
                    events={events}
                    onClose={() => setEditingRatesUserId(null)}
                    onSaved={(patches) => {
                        onPatchEvents(patches);
                        setEditingRatesUserId(null);
                    }}
                />
            ) : null}

            {isSuperAdmin ? <Modal
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
                        />
                    ) : null}

                    <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-4">
                        <Button
                            variant="secondary"
                            onClick={() => updateGroupDraft({ active: !groupDraft?.active })}
                            disabled={saving}
                        >
                            {groupDraft?.active ? "Desactivar" : "Activar"}
                        </Button>
                        <Button
                            variant="primary"
                            onClick={saveGroup}
                            disabled={saving || !groupDraft || isClosed}
                        >
                            {saving ? "Guardando..." : "Guardar grupo"}
                        </Button>
                    </div>
                </div>
            </Modal> : null}

            {isSuperAdmin ? <Modal
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

                    <div className="flex justify-end gap-2 border-t border-[#eef1f5] pt-4">
                        <Button
                            variant="danger"
                            onClick={confirmDeleteGroup}
                            disabled={saving || isClosed}
                        >
                            {saving ? "Eliminando..." : "Eliminar grupo"}
                        </Button>
                    </div>
                </div>
            </Modal> : null}
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

function SubscriptionSwitch({
    checked,
    disabled,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={checked ? "Desactivar suscripcion" : "Activar suscripcion"}
            title={checked ? "Desactivar suscripcion" : "Activar suscripcion"}
            onClick={onChange}
            disabled={disabled}
            className={[
                "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition disabled:cursor-not-allowed disabled:opacity-50",
                checked
                    ? "border-[#7c3aed] bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] shadow-[0_8px_18px_rgba(91,33,255,0.22)]"
                    : "border-[#d0d5dd] bg-[#f2f4f7]",
            ].join(" ")}
        >
            <span
                className={[
                    "flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
                    checked ? "translate-x-5 text-[#7c3aed]" : "translate-x-0 text-[#98a2b3]",
                ].join(" ")}
            >
                <AppIcon name={checked ? "check" : "pause"} size="sm" plain className="h-3.5 w-3.5 text-current" />
            </span>
        </button>
    );
}

function ClosedWeekPanel({
    summary,
    finalSummary,
    miGanancia,
    adminUsers,
    sellers,
    isSuperAdmin,
    profile,
    weekStartKey,
    weekEndKey,
}: {
    summary: AccountingSummary;
    finalSummary: NonNullable<WeeklyInvestmentDoc["finalSummary"]>;
    miGanancia?: number | null;
    adminUsers: UserDoc[];
    sellers: UserDoc[];
    isSuperAdmin: boolean;
    profile: UserDoc | null | undefined;
    weekStartKey: string;
    weekEndKey: string;
}) {
    const rows = finalSummary.rows ?? summary.rows;

    // For non-superadmin: scope all display values to their sellers only
    const sellerIds = new Set(sellers.map((u) => u.id));
    const displayRows = isSuperAdmin ? rows : rows.filter((row) => sellerIds.has(row.userId));
    const c2 = (n: number) => Math.round(n * 100) / 100;
    const dGross = isSuperAdmin ? finalSummary.gross : c2(displayRows.reduce((s, r) => s + r.gross, 0));
    const dCost = isSuperAdmin ? finalSummary.investment : c2(displayRows.reduce((s, r) => s + r.cost, 0));
    const dSubCost = isSuperAdmin ? finalSummary.subscriptionInvestment : dCost;
    const dExpenses = finalSummary.expensesTotal ?? 0;
    const dReal = isSuperAdmin ? finalSummary.real : c2(dGross - dCost - dExpenses);
    const dRoi: number | null = isSuperAdmin
        ? finalSummary.roi
        : ((dCost + dExpenses) > 0 ? (dReal / (dCost + dExpenses)) * 100 : null);
    const dVisited = isSuperAdmin ? finalSummary.visited : displayRows.reduce((s, r) => s + r.visited, 0);
    const dRejected = isSuperAdmin ? finalSummary.rejected : displayRows.reduce((s, r) => s + r.rejected, 0);
    const dAssigned = isSuperAdmin ? (finalSummary.assigned ?? 0) : displayRows.reduce((s, r) => s + r.assigned, 0);
    const dSubsPaid = isSuperAdmin ? finalSummary.subscriptionsPaid : displayRows.filter((r) => r.subscriptionPaid === true).length;
    const dRowsCount = isSuperAdmin ? finalSummary.rowsCount : displayRows.length;
    const dSubRows = isSuperAdmin
        ? (finalSummary.subscriptionRows ?? [])
        : (finalSummary.subscriptionRows ?? []).filter((item) => sellerIds.has(item.userId));

    const hasDrift = isSuperAdmin
        ? snapshotDiffers(summary, finalSummary)
        : (differs(summary.gross, dGross) || differs(summary.real, dReal) || summary.visited !== dVisited);

    const perVisitRows = isSuperAdmin
        ? (finalSummary.rows ?? []).filter((row) => row.billingMode === "per_visit" && (row.visited > 0 || row.gross > 0))
        : [];
    const groupDetails = (isSuperAdmin
        ? [
            finalSummary.groupInvestment > 0 ? { label: "Grupos de inversion", value: finalSummary.groupInvestment } : null,
            finalSummary.manualAdjustment > 0 ? { label: "Ajuste manual", value: finalSummary.manualAdjustment } : null,
            dSubCost > 0 ? { label: "Inversion suscripciones", value: dSubCost } : null,
        ]
        : [
            dSubCost > 0 ? { label: "Inversion suscripciones", value: dSubCost } : null,
        ]
    ).filter(Boolean) as { label: string; value: number }[];

    const [downloadOpen, setDownloadOpen] = useState(false);

    const snapExpenses = finalSummary.expenses ?? [];

    const snapMyGain: number | null = (() => {
        if (miGanancia == null) return null;
        if (!profile) return miGanancia;
        if (isSuperAdmin) {
            const givenAway = rows.reduce((acc, row) => {
                const user = sellers.find((u) => u.id === row.userId);
                const totalPct = (user?.sharedWith ?? []).reduce((s, sw) => s + sw.percentage, 0);
                return acc + (row.real * totalPct / 100);
            }, 0);
            const expensesTotal = finalSummary.expensesTotal ?? 0;
            const superadminExpenseShare = getExpenseShareFor(snapExpenses, profile.id, true);
            return finalSummary.real - givenAway + (expensesTotal - superadminExpenseShare);
        }
        const revenueShare = rows.reduce((acc, row) => {
            const user = sellers.find((u) => u.id === row.userId);
            const share = user?.sharedWith?.find((s) => s.adminId === profile.id);
            if (!share) return acc;
            return acc + (row.real * share.percentage / 100);
        }, 0);
        const adminExpenseShare = getExpenseShareFor(snapExpenses, profile.id, false);
        return revenueShare - adminExpenseShare;
    })();

    const adminGains = adminUsers
        .map((admin) => {
            const revenueShare = rows.reduce((acc, row) => {
                const user = sellers.find((u) => u.id === row.userId);
                const share = user?.sharedWith?.find((s) => s.adminId === admin.id);
                if (!share) return acc;
                return acc + (row.real * share.percentage / 100);
            }, 0);
            const adminExpenseShare = getExpenseShareFor(snapExpenses, admin.id, false);
            return { admin, gain: revenueShare - adminExpenseShare };
        })
        .filter(({ admin }) => sellers.some((u) => u.sharedWith?.some((s) => s.adminId === admin.id)));

    const receiptBase = {
        weekStartKey,
        weekEndKey,
        gross: dGross,
        subscriptionInvestment: dSubCost,
        real: dReal,
        expensesTotal: dExpenses,
    };

    const headerAction = (
        <div className="flex items-center gap-2">
            <Badge tone={hasDrift ? "yellow" : "green"}>
                {hasDrift ? "Diferencias" : "Snapshot vigente"}
            </Badge>
            <button
                type="button"
                onClick={() => setDownloadOpen(true)}
                title="Descargar"
                className="flex h-8 items-center gap-1.5 rounded-md border border-[#e4e7ec] bg-[#f9fafb] px-2 text-[12px] font-bold text-[#667085] transition hover:bg-[#f0edff] hover:text-[#7C3AED]"
            >
                <Icon name="download" />
                Descargar
            </button>
        </div>
    );

    return (
        <>
        <Card className="overflow-hidden border-emerald-200">
            <CardHeader
                title="Semana cerrada"
                subtitle={`Cierre guardado el ${formatDateTime(finalSummary.closedAt)}`}
                action={headerAction}
            />

            <div className={`grid gap-4 border-t border-[#eef1f5] p-4 ${snapMyGain != null ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
                <MiniInvestmentStat label="Bruta final" value={money(dGross)} />
                <MiniInvestmentStat label="Inversion final" value={money(dCost)} />
                <MiniInvestmentStat label="Real final" value={money(dReal)} tone={dReal >= 0 ? "green" : "red"} />
                {snapMyGain != null ? (
                    <MiniInvestmentStat label="Mi ganancia" value={money(snapMyGain)} tone={snapMyGain >= 0 ? "green" : "red"} />
                ) : null}
                <MiniInvestmentStat label="ROI final" value={formatPercent(dRoi)} />
            </div>

            {isSuperAdmin && adminGains.length > 0 ? (
                <div className="border-t border-[#eef1f5] p-4">
                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.08em] text-[#667085]">Ganancias de socios</div>
                    <div className="space-y-2">
                        {snapMyGain != null ? (
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-[#172033]">Mi ganancia (superadmin)</span>
                                <span className={`text-[12px] font-black ${snapMyGain >= 0 ? "text-emerald-600" : "text-red-500"}`}>{money(snapMyGain)}</span>
                            </div>
                        ) : null}
                        {adminGains.map(({ admin, gain }) => (
                            <div key={admin.id} className="flex items-center justify-between gap-3">
                                <span className="min-w-0 truncate text-[12px] font-semibold text-[#667085]">{admin.name || admin.email || admin.id}</span>
                                <span className={`shrink-0 text-[12px] font-black ${gain >= 0 ? "text-emerald-600" : "text-red-500"}`}>{money(gain)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="grid gap-3 border-t border-[#eef1f5] bg-[#f9fafb] p-4 text-[12px] font-semibold text-[#667085] sm:grid-cols-5">
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Asignados</span>
                    <span className="mt-1 block text-[#172033]">{dAssigned}</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Visitados</span>
                    <span className="mt-1 block text-[#172033]">{dVisited}</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Rechazados</span>
                    <span className="mt-1 block text-[#172033]">{dRejected}</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Suscripciones</span>
                    <span className="mt-1 block text-[#172033]">{dSubsPaid} pagadas</span>
                </div>
                <div>
                    <span className="block text-[10px] uppercase tracking-[0.08em] text-[#98a2b3]">Usuarios</span>
                    <span className="mt-1 block text-[#172033]">{dRowsCount} incluidos</span>
                </div>
            </div>

            {groupDetails.length || (isSuperAdmin && perVisitRows.length) ? (
                <div className="grid gap-3 border-t border-[#eef1f5] p-4 md:grid-cols-2">
                    {groupDetails.length ? (
                        <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
                            <div className="mb-2 text-[12px] font-black text-[#101936]">Inversiones guardadas</div>
                            <div className="space-y-1.5">
                                {groupDetails.map((item) => (
                                    <div key={item.label} className="flex items-center justify-between gap-3 text-[12px] font-semibold">
                                        <span className="text-[#667085]">{item.label}</span>
                                        <span className="font-black text-[#172033]">{money(item.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {isSuperAdmin && perVisitRows.length ? (
                        <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
                            <div className="mb-2 text-[12px] font-black text-[#101936]">Tarifas por cliente visitado</div>
                            <div className="space-y-1.5">
                                {perVisitRows.slice(0, 6).map((row) => (
                                    <div key={row.userId} className="flex items-center justify-between gap-3 text-[12px] font-semibold">
                                        <span className="min-w-0 truncate text-[#667085]">{row.name}</span>
                                        <span className="shrink-0 font-black text-[#172033]">{row.visited} visitas · {money(row.gross)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {dSubRows.length ? (
                <div className="border-t border-[#eef1f5] p-4">
                    <div className="mb-3 text-[12px] font-black text-[#101936]">Suscripciones guardadas en el cierre</div>
                    <div className="grid gap-2 md:grid-cols-2">
                        {dSubRows.map((item) => (
                            <div key={item.subscriptionId} className="rounded-lg border border-[#e4e7ec] bg-white px-3 py-2.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-[12px] font-bold text-[#172033]">{item.userName}</div>
                                        <div className="mt-0.5 truncate text-[11px] font-medium text-[#667085]">
                                            {[item.city, item.plan, item.source === "manual" ? "Manual" : "Pago real"].filter(Boolean).join(" · ")}
                                        </div>
                                    </div>
                                    <Badge tone={item.source === "real" ? "green" : "blue"}>
                                        {item.source === "real" ? "Real" : "Manual"}
                                    </Badge>
                                </div>
                                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-semibold">
                                    <MiniSnapshotValue label="Bruto" value={money(item.amount)} />
                                    <MiniSnapshotValue label="Costo" value={money(item.cost)} />
                                    <MiniSnapshotValue label="Real" value={money(item.real)} tone={item.real >= 0 ? "green" : "red"} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {hasDrift ? (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
                    El calculo actual ya no coincide exactamente con el snapshot final. Reabre y vuelve a cerrar si quieres actualizar el cierre.
                </div>
            ) : null}
        </Card>
        <DownloadSheet
            open={downloadOpen}
            onClose={() => setDownloadOpen(false)}
            onExcel={() => {
                const closedSummary: AccountingSummary = {
                    startKey: weekStartKey,
                    endKey: weekEndKey,
                    visited: finalSummary.visited,
                    rejected: finalSummary.rejected,
                    assigned: finalSummary.assigned ?? 0,
                    gross: dGross,
                    grossVisits: finalSummary.grossVisits,
                    grossSubscriptions: finalSummary.grossSubscriptions,
                    subscriptionsPaid: finalSummary.subscriptionsPaid,
                    investment: dCost,
                    subscriptionInvestment: dSubCost,
                    groupInvestment: finalSummary.groupInvestment,
                    manualAdjustment: finalSummary.manualAdjustment,
                    real: dReal,
                    roi: dRoi,
                    rows: finalSummary.rows ?? [],
                    subscriptionRows: finalSummary.subscriptionRows ?? [],
                    expenses: snapExpenses,
                    expensesTotal: dExpenses,
                };
                exportAccountingSheet(closedSummary, snapMyGain, isSuperAdmin, snapExpenses);
            }}
            receipts={[
                ...(snapMyGain != null && isSuperAdmin && profile ? [{
                    label: profile.name || "Superadmin",
                    onClick: () => downloadReceiptAsImage({
                        ...receiptBase,
                        adminName: profile.name || profile.email || "SuperAdmin",
                        miGanancia: snapMyGain,
                        expenses: snapExpenses,
                    }),
                }] : []),
                ...(snapMyGain != null && !isSuperAdmin && profile ? [{
                    label: profile.name || profile.email || "Admin",
                    onClick: () => downloadReceiptAsImage({
                        ...receiptBase,
                        adminName: profile.name || profile.email || "Admin",
                        miGanancia: snapMyGain,
                        expenses: snapExpenses,
                    }),
                }] : []),
                ...adminGains.map(({ admin, gain }) => ({
                    label: admin.name || admin.email || admin.id,
                    onClick: () => downloadReceiptAsImage({
                        ...receiptBase,
                        adminName: admin.name || admin.email || admin.id,
                        miGanancia: gain,
                        expenses: snapExpenses,
                    }),
                })),
            ]}
        />
        </>
    );
}

function MiniSnapshotValue({
    label,
    value,
    tone = "default",
}: {
    label: string;
    value: string;
    tone?: "default" | "green" | "red";
}) {
    const valueClass =
        tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-500" : "text-[#172033]";

    return (
        <div className="rounded-lg bg-[#f9fafb] px-2 py-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-[#98a2b3]">{label}</div>
            <div className={`mt-0.5 text-[11px] font-black ${valueClass}`}>{value}</div>
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
    const [open, setOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
    const ref = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect) {
            const width = 176;
            const height = 148;
            const spaceBelow = window.innerHeight - rect.bottom;
            const top = spaceBelow < height + 24
                ? Math.max(12, rect.top - height - 8)
                : rect.bottom + 8;
            const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
            setMenuStyle({ left, top, width });
        }

        function close(e: Event) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", close);
        document.addEventListener("touchstart", close);
        document.addEventListener("scroll", () => setOpen(false), { capture: true, once: true });
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("touchstart", close);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative rounded-lg border border-[#e4e7ec] bg-white p-3">
            <div className="flex items-start justify-between gap-3">
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

                <button
                    ref={buttonRef}
                    type="button"
                    aria-label="Opciones del grupo"
                    title="Opciones del grupo"
                    onClick={() => setOpen((v) => !v)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#e4e7ec] bg-white text-[#667085] shadow-sm transition hover:bg-[#f9fafb] hover:text-[#172033]"
                >
                    <Icon name="moreHorizontal" />
                </button>
            </div>

            {open ? (
                <div
                    className="fixed z-[90] overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-[0_18px_45px_rgba(16,25,54,0.18)]"
                    style={menuStyle}
                >
                    <button
                        type="button"
                        onClick={() => { setOpen(false); onEdit(); }}
                        disabled={disabled}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-[#344054] hover:bg-[#f8f7ff]"
                    >
                        <Icon name="edit" />
                        <span>Editar</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => { setOpen(false); onToggleActive(); }}
                        disabled={disabled}
                        className="flex w-full items-center gap-2 border-t border-[#e4e7ec] px-3 py-2.5 text-left text-[12px] font-semibold text-[#344054] hover:bg-[#f8f7ff]"
                    >
                        <Icon name={group.active ? "pause" : "play"} />
                        <span>{group.active ? "Inactivar" : "Activar"}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => { setOpen(false); onDelete(); }}
                        disabled={disabled}
                        className="flex w-full items-center gap-2 border-t border-[#e4e7ec] px-3 py-2.5 text-left text-[12px] font-semibold text-red-600 hover:bg-red-50"
                    >
                        <Icon name="trash" />
                        <span>Eliminar</span>
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function InvestmentGroupCard({
    index,
    group,
    users,
    onChange,
    onToggleUser,
}: {
    index: number;
    group: GroupDraft;
    users: UserDoc[];
    onChange: (patch: Partial<GroupDraft>) => void;
    onToggleUser: (userId: string) => void;
}) {
    const selectedUsers = users.filter((user) => group.userIds.includes(user.id));
    const availableUsers = users.filter((user) => !group.userIds.includes(user.id));

    return (
        <div className="rounded-lg border border-[#e4e7ec] bg-white">
            <div className="border-b border-[#eef1f5] px-3 py-3">
                <div className="text-[12px] font-semibold text-[#172033]">
                    Grupo {index + 1}
                </div>
                <div className="mt-0.5 text-[11px] font-medium text-[#98a2b3]">
                    {group.userIds.length} usuarios seleccionados
                </div>
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

function eventMoneyValue(event: DailyEventDoc, userRatePerVisit?: number) {
    return effectiveRate(event, userRatePerVisit);
}

function buildDailyChartSeries(
    events: DailyEventDoc[],
    assignments: AccountingAssignmentDoc[],
    startDate: Date,
    endDate: Date,
    metric: AccountingMetric,
    userRates?: Map<string, number>
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
        if (metric === "gross") value = event.type === "visited" ? eventMoneyValue(event, userRates?.get(event.userId)) : 0;
        if (metric === "real") value = event.type === "visited" ? eventMoneyValue(event, userRates?.get(event.userId)) : 0;
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
    users,
    miGanancia,
    isSuperAdmin,
    exportSummary,
    snapMiGanancia,
    expenses,
    onDownload,
}: {
    summary: AccountingSummary;
    events: DailyEventDoc[];
    assignments: AccountingAssignmentDoc[];
    startDate: Date;
    endDate: Date;
    users: UserDoc[];
    miGanancia?: number | null;
    isSuperAdmin?: boolean;
    exportSummary?: AccountingSummary | null;
    snapMiGanancia?: number | null;
    expenses?: WeeklyExpenseDoc[];
    onDownload?: () => void;
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
    const dashUserRatesMap = useMemo(() => {
        const map = new Map<string, number>();
        for (const user of users) {
            if (user.ratePerVisit != null) map.set(user.id, user.ratePerVisit);
        }
        return map;
    }, [users]);

    const chartSeries = useMemo(() => {
        return buildDailyChartSeries(events, assignments, startDate, endDate, chartMetric, dashUserRatesMap);
    }, [events, assignments, startDate, endDate, chartMetric, dashUserRatesMap]);

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
                                    <option value="share">Participacion</option>
                                </select>
                            </div>
                        }
                    />

                    <div className="border-t border-[#eef1f5] p-3 sm:p-4">
                        <div className={`grid gap-2 sm:gap-3 ${
                            miGanancia != null && (expenses ?? []).length > 0
                                ? "grid-cols-5"
                                : miGanancia != null || (expenses ?? []).length > 0
                                    ? "grid-cols-4"
                                    : "grid-cols-3"
                        }`}>
                            <Metric label="Ganancia bruta" value={money(summary.gross)} delta="+ semana" tone="green" />
                            <Metric
                                label="Inversion"
                                value={money(isSuperAdmin ? summary.investment : summary.subscriptionInvestment)}
                                delta={isSuperAdmin
                                    ? `${money(summary.subscriptionInvestment)} sub · ${money(summary.groupInvestment)} grp · ${money(summary.manualAdjustment)} aj`
                                    : `${money(summary.subscriptionInvestment)} sub`}
                                tone="neutral"
                            />
                            <Metric
                                label="Ganancia real"
                                value={money(summary.real)}
                                delta={`ROI ${formatPercent(summary.roi)}`}
                                tone={summary.real >= 0 ? "green" : "red"}
                            />
                            {miGanancia != null ? (
                                <Metric
                                    label="Mi ganancia"
                                    value={money(miGanancia)}
                                    delta="Tu parte"
                                    tone={miGanancia >= 0 ? "green" : "red"}
                                />
                            ) : null}
                            {(expenses ?? []).length > 0 ? (
                                <Metric
                                    label="Gastos"
                                    value={money(summary.expensesTotal ?? 0)}
                                    delta={`${expenses?.length ?? 0} concepto${(expenses?.length ?? 0) !== 1 ? "s" : ""}`}
                                    tone="red"
                                />
                            ) : null}
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
                                        {row.subscriptionSource === "real"
                                            ? "Suscripcion pagada"
                                            : row.billingMode === "weekly_subscription"
                                                ? "Suscripcion manual"
                                                : "Por visita"}
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
                            label="Descargar"
                            onClick={() => onDownload?.()}
                        />
                    }
                />

                <div className="border-t border-[#eef1f5]">
                    <div className="divide-y divide-[#eef1f5] lg:hidden">
                        {activeRows.map((row) => (
                            <AccountingUserMobileCard
                                key={row.userId}
                                row={row}
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
                                            <ModelBadge mode={row.billingMode} paid={row.subscriptionPaid} source={row.subscriptionSource} />
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

function UserEventsModal({
    userId,
    userName,
    userRatePerVisit,
    events,
    onClose,
    onSaved,
}: {
    userId: string;
    userName: string;
    userRatePerVisit?: number;
    events: DailyEventDoc[];
    onClose: () => void;
    onSaved: (patches: { id: string; rateApplied: number; amount: number }[]) => void;
}) {
    const userEvents = useMemo(
        () => events.filter((e) => e.userId === userId && e.type === "visited"),
        [events, userId]
    );

    const [rates, setRates] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        for (const event of userEvents) {
            initial[event.id] = String(effectiveRate(event, userRatePerVisit));
        }
        return initial;
    });
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    async function handleSave() {
        setSaving(true);
        setSaveError(null);

        try {
            const patches: { id: string; rateApplied: number; amount: number }[] = [];

            for (const event of userEvents) {
                const original = effectiveRate(event, userRatePerVisit);
                const newRate = safeNumber(rates[event.id], original);
                if (Math.abs(newRate - original) > 0.001) {
                    await updateDailyEventRate(event.id, newRate);
                    patches.push({ id: event.id, rateApplied: newRate, amount: newRate });
                }
            }

            onSaved(patches);
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "No se pudieron guardar las tarifas.");
            setSaving(false);
        }
    }

    return (
        <Modal open onClose={onClose} title="Editar tarifas" subtitle={userName} size="sm">
            <div className="space-y-3">
                {userEvents.length === 0 ? (
                    <p className="py-2 text-[13px] font-medium text-[#667085]">Sin visitas registradas esta semana.</p>
                ) : (
                    <div className="divide-y divide-[#eef1f5]">
                        {userEvents.map((event) => (
                            <div key={event.id} className="flex items-center gap-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] font-semibold text-[#172033]">
                                        {event.name || event.business || event.clientId}
                                    </div>
                                    <div className="text-[11px] font-medium text-[#98a2b3]">{event.dayKey}</div>
                                </div>
                                <div className="w-24 shrink-0">
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={rates[event.id] ?? ""}
                                        onChange={(e) =>
                                            setRates((prev) => ({ ...prev, [event.id]: e.target.value }))
                                        }
                                        disabled={saving}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {saveError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
                        {saveError}
                    </div>
                ) : null}

                <div className="flex justify-end border-t border-[#eef1f5] pt-3">
                    {userEvents.length > 0 ? (
                        <Button
                            variant="primary"
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? "Guardando..." : "Guardar"}
                        </Button>
                    ) : null}
                </div>
            </div>
        </Modal>
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
            <div className="truncate text-[10px] font-black uppercase tracking-[0.06em] text-[#667085] sm:text-[11px] sm:font-medium sm:normal-case sm:tracking-normal">
                {label}
            </div>

            <div className="mt-0.5 flex items-end gap-2 sm:mt-1">
                <span className="truncate text-[clamp(13px,4.2vw,17px)] font-black leading-none tracking-[-0.04em] text-[#172033] sm:text-[20px] sm:font-semibold">
                    {value}
                </span>
            </div>

            <div
                className={
                    tone === "green"
                        ? "mt-0.5 truncate text-[9px] font-semibold text-emerald-600 sm:text-[11px]"
                        : tone === "red"
                            ? "mt-0.5 truncate text-[9px] font-semibold text-red-500 sm:text-[11px]"
                            : "mt-0.5 truncate text-[9px] font-semibold text-[#98a2b3] sm:text-[11px]"
                }
            >
                {delta}
            </div>
        </div>
    );
}

function AccountingUserMobileCard({
    row,
}: {
    row: AccountingSummary["rows"][number];
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
                <ModelBadge mode={row.billingMode} paid={row.subscriptionPaid} source={row.subscriptionSource} />
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
    source,
}: {
    mode: "per_visit" | "weekly_subscription";
    paid?: boolean;
    source?: "real" | "manual" | "none";
}) {
    if (mode === "weekly_subscription") {
        if (source === "real") {
            return <Badge tone="green">Suscripcion pagada</Badge>;
        }

        return (
            <Badge tone={paid ? "blue" : "gray"}>
                {paid ? "Suscripcion manual" : "Suscripcion no pagada"}
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
