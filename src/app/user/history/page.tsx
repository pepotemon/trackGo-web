"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import {
    markLeadRejected,
    markLeadVisited,
    resetLeadPending,
    subscribeUserLeads,
} from "@/data/userLeadsRepo";
import type { MetaLeadDoc } from "@/types/leads";
import {
    REJECTED_REASON_LABELS,
    type RejectedReason,
} from "@/types/userLeads";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import { useWhatsAppDailyLimit } from "@/hooks/useWhatsAppDailyLimit";

type HistoryFilter = "all" | "visited" | "rejected";

const SPANISH_3DIGIT_CC = ["507","502","503","504","505","506","509","593","591","595","598"];
const SPANISH_PHONE_PREFIXES = [...SPANISH_3DIGIT_CC, "52","54","56","57","51","58"];
function isSpanishPhone(phone: string) {
    const d = phone.replace(/\D/g, "");
    if (SPANISH_PHONE_PREFIXES.some(p => d.startsWith(p))) return true;
    if (d.startsWith("55") && SPANISH_3DIGIT_CC.some(cc => d.slice(2).startsWith(cc))) return true;
    return false;
}
function buildWALink(phone: string, msg: string) {
    const d = phone.replace(/\D/g, "");
    if (SPANISH_PHONE_PREFIXES.some(p => d.startsWith(p))) return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
    if (d.startsWith("55")) {
        const stripped = d.slice(2);
        if (SPANISH_3DIGIT_CC.some(cc => stripped.startsWith(cc))) return `https://wa.me/${stripped}?text=${encodeURIComponent(msg)}`;
        return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
    }
    return `https://wa.me/55${d}?text=${encodeURIComponent(msg)}`;
}
type RangePreset = "all" | "week" | "7d" | "month" | "custom";

const REJECTION_REASONS = Object.entries(REJECTED_REASON_LABELS) as [RejectedReason, string][];

function todayKey() { return new Date().toISOString().slice(0, 10); }

function thisWeekRange(): { startKey: string; endKey: string } {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { startKey: mon.toISOString().slice(0, 10), endKey: sun.toISOString().slice(0, 10) };
}

function last7DaysRange(): { startKey: string; endKey: string } {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
    return { startKey: start.toISOString().slice(0, 10), endKey: end.toISOString().slice(0, 10) };
}

function thisMonthRange(): { startKey: string; endKey: string } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startKey: start.toISOString().slice(0, 10), endKey: end.toISOString().slice(0, 10) };
}

function displayName(lead: MetaLeadDoc) {
    return lead.name || lead.business || lead.phone || "Sin nombre";
}

function norm(s: unknown) {
    return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function formatDateLabel(ts: number | null | undefined): string {
    if (!ts) return "";
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const date = new Date(d); date.setHours(0, 0, 0, 0);
    if (date.getTime() === today.getTime()) return "Hoy";
    if (date.getTime() === yesterday.getTime()) return "Ayer";
    return new Intl.DateTimeFormat("es", { day: "2-digit", month: "long", year: "numeric" }).format(d);
}

function formatTime(ts: number | null | undefined): string {
    if (!ts) return "";
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function formatRangeLabel(preset: RangePreset, startKey: string, endKey: string): string {
    if (preset === "all") return "Todo el historial";
    if (preset === "week") return "Esta semana";
    if (preset === "7d") return "Últimos 7 días";
    if (preset === "month") return "Este mes";
    const fmt = (k: string) => {
        const [y, m, d] = k.split("-");
        return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(new Date(+y, +m - 1, +d));
    };
    return `${fmt(startKey)} – ${fmt(endKey)}`;
}

const PRESETS: { key: RangePreset; label: string }[] = [
    { key: "all", label: "Todo el historial" },
    { key: "week", label: "Esta semana" },
    { key: "7d", label: "Últimos 7 días" },
    { key: "month", label: "Este mes" },
    { key: "custom", label: "Personalizado" },
];

const FILTER_LABELS: Record<HistoryFilter, string> = {
    all: "Todos",
    visited: "Visitados",
    rejected: "Rechazados",
};

export default function UserHistoryPage() {
    const { firebaseUser } = useAuth();
    const userId = firebaseUser?.uid ?? "";
    const today = todayKey();
    const { triggerWa, WaLimitModal } = useWhatsAppDailyLimit();

    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<HistoryFilter>("all");
    const [search, setSearch] = useState("");

    const [rangePreset, setRangePreset] = useState<RangePreset>("month");
    const [customStart, setCustomStart] = useState(thisWeekRange().startKey);
    const [customEnd, setCustomEnd] = useState(today);

    const [filterModalOpen, setFilterModalOpen] = useState(false);

    const [actionLead, setActionLead] = useState<MetaLeadDoc | null>(null);
    const [actionType, setActionType] = useState<"visit" | "reject" | null>(null);
    const [rejectStep, setRejectStep] = useState<1 | 2>(1);
    const [rejectReason, setRejectReason] = useState<RejectedReason | null>(null);
    const [rejectText, setRejectText] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!userId) return;
        setLoading(true);
        const unsub = subscribeUserLeads(userId, (data) => {
            setLeads(data);
            setLoading(false);
        });
        return unsub;
    }, [userId]);

    const { startKey, endKey } = useMemo(() => {
        if (rangePreset === "week") return thisWeekRange();
        if (rangePreset === "7d") return last7DaysRange();
        if (rangePreset === "month") return thisMonthRange();
        if (rangePreset === "custom") return { startKey: customStart, endKey: customEnd };
        return { startKey: "", endKey: "" };
    }, [rangePreset, customStart, customEnd]);

    const historyLeads = useMemo(() => {
        return leads
            .filter((l) => l.status === "visited" || l.status === "rejected")
            .sort((a, b) => (b.statusAt ?? b.assignedAt ?? 0) - (a.statusAt ?? a.assignedAt ?? 0));
    }, [leads]);

    const rangeLeads = useMemo(() => {
        if (rangePreset === "all") return historyLeads;
        return historyLeads.filter((l) => {
            const ts = l.statusAt ?? l.assignedAt;
            if (!ts) return true;
            const key = new Date(ts).toISOString().slice(0, 10);
            return key >= startKey && key <= endKey;
        });
    }, [historyLeads, rangePreset, startKey, endKey]);

    const stats = useMemo(() => ({
        visited: rangeLeads.filter((l) => l.status === "visited").length,
        rejected: rangeLeads.filter((l) => l.status === "rejected").length,
    }), [rangeLeads]);

    const filtered = useMemo(() => {
        let list = rangeLeads;
        if (filter === "visited") list = list.filter((l) => l.status === "visited");
        else if (filter === "rejected") list = list.filter((l) => l.status === "rejected");
        if (search.trim()) {
            const q = norm(search.trim());
            list = list.filter((l) =>
                norm(l.name).includes(q) ||
                norm(l.business).includes(q) ||
                norm(l.phone).includes(q) ||
                norm(l.location.address).includes(q)
            );
        }
        return list;
    }, [rangeLeads, filter, search]);

    const counts = useMemo(() => ({
        all: rangeLeads.length,
        visited: rangeLeads.filter((l) => l.status === "visited").length,
        rejected: rangeLeads.filter((l) => l.status === "rejected").length,
    }), [rangeLeads]);

    const grouped = useMemo(() => {
        const groups: { label: string; items: MetaLeadDoc[] }[] = [];
        const seen = new Map<string, MetaLeadDoc[]>();
        for (const lead of filtered) {
            const label = formatDateLabel(lead.statusAt ?? lead.assignedAt);
            if (!seen.has(label)) { seen.set(label, []); groups.push({ label, items: seen.get(label)! }); }
            seen.get(label)!.push(lead);
        }
        return groups;
    }, [filtered]);

    const filtersActive = rangePreset !== "all" || filter !== "all";

    function canUndo(lead: MetaLeadDoc) {
        if (!lead.statusAt) return true;
        return new Date(lead.statusAt).toISOString().slice(0, 10) === today;
    }

    function openVisit(lead: MetaLeadDoc) { setActionLead(lead); setActionType("visit"); }
    function openReject(lead: MetaLeadDoc) {
        setActionLead(lead); setActionType("reject");
        setRejectStep(1); setRejectReason(null); setRejectText("");
    }
    function closeAction() { setActionLead(null); setActionType(null); setSaving(false); }
    useBackButtonDismiss(filterModalOpen, () => setFilterModalOpen(false));
    useBackButtonDismiss(Boolean(actionType), closeAction);

    async function confirmVisit() {
        if (!actionLead || !userId) return;
        setSaving(true);
        try { await markLeadVisited(actionLead, userId); closeAction(); }
        catch { setSaving(false); }
    }

    function selectReason(r: RejectedReason) {
        setRejectReason(r);
        if (r !== "otro") setRejectStep(2);
    }

    async function confirmReject() {
        if (!actionLead || !rejectReason || !userId) return;
        setSaving(true);
        try { await markLeadRejected(actionLead, userId, rejectReason, rejectText); closeAction(); }
        catch { setSaving(false); }
    }

    async function handleUndo(lead: MetaLeadDoc) {
        if (!userId) return;
        await resetLeadPending(lead, userId);
    }

    function openWhatsApp(lead: MetaLeadDoc) {
        const msg = isSpanishPhone(lead.phone)
            ? `¡Buenas tardes! Somos de Crédito Comercial. Nos comunicamos para continuar con la liberación del crédito y el registro de tu negocio. ¡Quedamos atentos! 😊`
            : `Boa tarde! Somos da Crédito Comercial. Estamos entrando em contato para dar continuidade à liberação do crédito e realização do cadastro. Aguardamos seu retorno! 😊`;
        triggerWa(() => { window.open(buildWALink(lead.phone, msg), "_blank"); });
    }

    function openMaps(lead: MetaLeadDoc) {
        const url = lead.location.mapsUrl || `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}`;
        window.open(url, "_blank");
    }

    return (
        <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.08),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)]">

            {/* ── STICKY HEADER ───────────────────────────────────────── */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-4 backdrop-blur-md xl:px-6">

                {/* TITLE ROW */}
                <div className="mb-3 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#101936]">Historial</h1>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739A]">
                            {formatRangeLabel(rangePreset, startKey, endKey)}
                            {" · "}{counts.all} {counts.all === 1 ? "prospecto" : "prospectos"}
                            {filter !== "all" ? ` · ${FILTER_LABELS[filter]}` : ""}
                        </p>
                    </div>

                    {/* Filter button */}
                    <button
                        type="button"
                        onClick={() => setFilterModalOpen(true)}
                        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                        aria-label="Filtros"
                    >
                        <FilterIcon />
                        {filtersActive ? (
                            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#7C3AED]" />
                        ) : null}
                    </button>
                </div>

                {/* SEARCH BAR */}
                <div className="mb-3 flex items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 py-2.5 shadow-sm">
                    <SearchIcon />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Nombre, negocio, teléfono..."
                        className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                    />
                    {search ? (
                        <button type="button" onClick={() => setSearch("")} className="text-[16px] leading-none text-[#98A2B3]">×</button>
                    ) : null}
                </div>

                {/* STATS */}
                <div className="grid grid-cols-2 gap-2">
                    <StatPill label="Visitados" value={stats.visited} tone="green" />
                    <StatPill label="Rechazados" value={stats.rejected} tone="red" />
                </div>
            </div>

            {/* ── LIST ────────────────────────────────────────────────── */}
            <div className="flex-1 px-3 pb-4 pt-2 xl:px-6">
                {loading ? (
                    <LoadingState />
                ) : grouped.length === 0 ? (
                    <EmptyState filter={filter} search={search} />
                ) : (
                    <div className="space-y-4">
                        {grouped.map(({ label, items }) => (
                            <section key={label}>
                                <div className="mb-2 flex items-center gap-2">
                                    <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[#7C3AED]">{label}</span>
                                    <div className="flex-1 border-t border-[#E8E7FB]" />
                                    <span className="text-[10px] font-bold text-[#98A2B3]">{items.length}</span>
                                </div>
                                <div className="grid gap-2">
                                    {items.map((lead) => (
                                        <HistoryCard
                                            key={lead.id}
                                            lead={lead}
                                            canUndo={canUndo(lead)}
                                            onVisit={() => openVisit(lead)}
                                            onReject={() => openReject(lead)}
                                            onUndo={() => handleUndo(lead)}
                                            onWhatsApp={() => openWhatsApp(lead)}
                                            onMaps={() => openMaps(lead)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            {/* ── FILTER MODAL ────────────────────────────────────────── */}
            {filterModalOpen ? (
                <BottomSheet onClose={() => setFilterModalOpen(false)} tall>
                    <p className="mb-4 text-[16px] font-black text-[#101936]">Filtros</p>

                    {/* Range presets */}
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#98A2B3]">Período</p>
                    <div className="mb-4 grid gap-1.5">
                        {PRESETS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => setRangePreset(p.key)}
                                className={[
                                    "flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left text-[13px] font-bold transition",
                                    rangePreset === p.key
                                        ? "border-[#7C3AED] bg-[#f3f0ff] text-[#5b21ff]"
                                        : "border-[#E8E7FB] bg-white text-[#344054]",
                                ].join(" ")}
                            >
                                <span className={[
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition",
                                    rangePreset === p.key ? "border-[#7C3AED] bg-[#7C3AED]" : "border-[#D0D5DD]",
                                ].join(" ")} />
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* Custom date inputs */}
                    {rangePreset === "custom" ? (
                        <div className="mb-4 flex items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 py-2 shadow-sm">
                            <input
                                type="date"
                                value={customStart}
                                max={customEnd}
                                onChange={(e) => setCustomStart(e.target.value)}
                                className="flex-1 bg-transparent text-[12px] font-bold text-[#101936] outline-none"
                            />
                            <span className="text-[10px] font-black text-[#98A2B3]">→</span>
                            <input
                                type="date"
                                value={customEnd}
                                min={customStart}
                                max={today}
                                onChange={(e) => setCustomEnd(e.target.value)}
                                className="flex-1 bg-transparent text-[12px] font-bold text-[#101936] outline-none"
                            />
                        </div>
                    ) : null}

                    {/* Status filter */}
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#98A2B3]">Estado</p>
                    <div className="mb-5 grid gap-1.5">
                        {(["all", "visited", "rejected"] as HistoryFilter[]).map((f) => (
                            <button
                                key={f}
                                type="button"
                                onClick={() => setFilter(f)}
                                className={[
                                    "flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left text-[13px] font-bold transition",
                                    filter === f
                                        ? "border-[#7C3AED] bg-[#f3f0ff] text-[#5b21ff]"
                                        : "border-[#E8E7FB] bg-white text-[#344054]",
                                ].join(" ")}
                            >
                                <span className={[
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition",
                                    filter === f ? "border-[#7C3AED] bg-[#7C3AED]" : "border-[#D0D5DD]",
                                ].join(" ")} />
                                {FILTER_LABELS[f]}
                                <span className="ml-auto text-[11px] font-black text-[#98A2B3]">{counts[f]}</span>
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => setFilterModalOpen(false)}
                        className="w-full rounded-[14px] bg-[#7C3AED] py-3 text-[14px] font-black text-white"
                    >
                        Aplicar
                    </button>
                </BottomSheet>
            ) : null}

            {/* ── VISIT MODAL ─────────────────────────────────────────── */}
            {actionType === "visit" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <div className="mb-4">
                        <div className="mb-1">
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">VISITA</span>
                        </div>
                        <p className="text-[17px] font-black text-[#101936]">{displayName(actionLead)}</p>
                        {actionLead.location.address ? (
                            <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{actionLead.location.address}</p>
                        ) : null}
                    </div>
                    <p className="mb-4 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-[12px] font-semibold text-emerald-700">
                        ¿Confirmas que visitaste a este prospecto hoy?
                    </p>
                    <div className="flex gap-2">
                        <button type="button" onClick={closeAction} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">
                            Cancelar
                        </button>
                        <button type="button" onClick={confirmVisit} disabled={saving} className="flex-1 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {saving ? "Guardando..." : "Sí, visité"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {/* ── REJECT MODAL ────────────────────────────────────────── */}
            {actionType === "reject" && actionLead ? (
                <BottomSheet onClose={closeAction} tall>
                    <div className="mb-4">
                        <div className="mb-1">
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black text-red-700">RECHAZO</span>
                        </div>
                        <p className="text-[17px] font-black text-[#101936]">{displayName(actionLead)}</p>
                    </div>

                    {rejectStep === 1 ? (
                        <>
                            <p className="mb-3 text-[12px] font-bold text-[#66739A]">¿Por qué rechazas este prospecto?</p>
                            <div className="grid gap-2">
                                {REJECTION_REASONS.map(([key, label]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => selectReason(key)}
                                        className={[
                                            "flex items-center gap-2.5 rounded-[14px] border px-3 py-2.5 text-left text-[13px] font-bold transition",
                                            rejectReason === key
                                                ? "border-red-300 bg-red-50 text-red-700"
                                                : "border-[#E8E7FB] bg-white text-[#344054]",
                                        ].join(" ")}
                                    >
                                        <span className={[
                                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                                            rejectReason === key ? "border-red-500 bg-red-500" : "border-[#D0D5DD]",
                                        ].join(" ")} />
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {rejectReason === "otro" ? (
                                <textarea
                                    className="mt-3 w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-2.5 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                                    rows={3}
                                    placeholder="Explica el motivo..."
                                    value={rejectText}
                                    onChange={(e) => setRejectText(e.target.value)}
                                />
                            ) : null}
                            <div className="mt-4 flex gap-2">
                                <button type="button" onClick={closeAction} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => rejectReason && setRejectStep(2)}
                                    disabled={!rejectReason || (rejectReason === "otro" && !rejectText.trim())}
                                    className="flex-1 rounded-[14px] bg-[#7C3AED] py-3 text-[13px] font-black text-white disabled:opacity-40"
                                >
                                    Siguiente
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="mb-4 rounded-[14px] border border-red-100 bg-red-50 px-3 py-3">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-red-400">Razón del rechazo</p>
                                <p className="mt-1 text-[14px] font-black text-red-700">
                                    {rejectReason ? REJECTED_REASON_LABELS[rejectReason] : ""}
                                </p>
                                {rejectText ? <p className="mt-0.5 text-[12px] font-semibold text-red-600">{rejectText}</p> : null}
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setRejectStep(1)} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">
                                    Atrás
                                </button>
                                <button type="button" onClick={confirmReject} disabled={saving} className="flex-1 rounded-[14px] bg-red-600 py-3 text-[13px] font-black text-white disabled:opacity-60">
                                    {saving ? "Guardando..." : "Confirmar rechazo"}
                                </button>
                            </div>
                        </>
                    )}
                </BottomSheet>
            ) : null}

            {WaLimitModal}
        </div>
    );
}

// ── HISTORY CARD ─────────────────────────────────────────────────────────────

function HistoryCard({
    lead, canUndo, onVisit, onReject, onUndo, onWhatsApp, onMaps,
}: {
    lead: MetaLeadDoc;
    canUndo: boolean;
    onVisit: () => void;
    onReject: () => void;
    onUndo: () => void;
    onWhatsApp: () => void;
    onMaps: () => void;
}) {
    const isVisited = lead.status === "visited";

    return (
        <div className={[
            "overflow-hidden rounded-[18px] border bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]",
            isVisited ? "border-emerald-200 bg-emerald-50/20" : "border-red-200 bg-red-50/20",
        ].join(" ")}>
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-black text-[#101936]">{displayName(lead)}</p>
                        {lead.business && lead.name ? (
                            <p className="truncate text-[11px] font-semibold text-[#66739A]">{lead.business}</p>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={lead.status} />
                        {lead.statusAt ? (
                            <span className="text-[10px] font-semibold text-[#98A2B3]">{formatTime(lead.statusAt)}</span>
                        ) : null}
                    </div>
                </div>

                <div className="mt-2 space-y-1">
                    {lead.phone ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PhoneIcon /><span className="truncate">{lead.phone}</span>
                        </div>
                    ) : null}
                    {lead.location.address ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PinIcon /><span className="truncate">{lead.location.address}</span>
                        </div>
                    ) : null}
                    {lead.status === "rejected" && lead.rejectedReason ? (
                        <div className="flex items-center gap-1.5">
                            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">
                                {REJECTED_REASON_LABELS[lead.rejectedReason as RejectedReason] ?? lead.rejectedReason}
                            </span>
                        </div>
                    ) : null}
                </div>

                <div className="mt-3 flex items-center gap-2 border-t border-[#F2F0FF] pt-2.5">
                    <div className="flex gap-1.5">
                        <button type="button" onClick={onWhatsApp} title="WhatsApp"
                            className="flex h-8 w-8 items-center justify-center rounded-[11px] border border-emerald-200 bg-emerald-50 text-emerald-700 transition active:opacity-70">
                            <WAIcon />
                        </button>
                        <button type="button" onClick={onMaps} title="Maps"
                            className="flex h-8 w-8 items-center justify-center rounded-[11px] border border-blue-200 bg-blue-50 text-blue-700 transition active:opacity-70">
                            <MapsIcon />
                        </button>
                    </div>
                    <div className="flex-1" />
                    {canUndo ? (
                        <button type="button" onClick={onUndo}
                            className="flex h-8 items-center gap-1.5 rounded-[11px] border border-[#E8E7FB] bg-white px-2.5 text-[11px] font-black text-[#66739A] transition active:bg-[#f3f0ff]">
                            <UndoIcon /> Deshacer
                        </button>
                    ) : (
                        isVisited ? (
                            <button type="button" onClick={onReject}
                                className="flex h-8 items-center gap-1.5 rounded-[11px] border border-red-200 bg-red-50 px-2.5 text-[11px] font-black text-red-600 transition active:bg-red-100">
                                <XIcon /> Rechazar
                            </button>
                        ) : (
                            <button type="button" onClick={onVisit}
                                className="flex h-8 items-center gap-1.5 rounded-[11px] border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700 transition active:bg-emerald-100">
                                <CheckIcon /> Visité
                            </button>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
    if (status === "visited") return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">Visitado</span>
    );
    return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-black text-red-700">Rechazado</span>
    );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone: "green" | "red" }) {
    return (
        <div className={[
            "rounded-[12px] border px-3 py-2 text-center",
            tone === "green" ? "border-emerald-100 bg-emerald-50" : "border-red-100 bg-red-50",
        ].join(" ")}>
            <div className={["text-[22px] font-black leading-none", tone === "green" ? "text-emerald-700" : "text-red-700"].join(" ")}>{value}</div>
            <div className="mt-1 text-[10px] font-black text-[#98A2B3]">{label}</div>
        </div>
    );
}

function BottomSheet({ children, onClose, tall }: { children: React.ReactNode; onClose: () => void; tall?: boolean }) {
    return (
        <div className="fixed inset-0 z-50 flex items-end xl:items-center xl:justify-center">
            <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className={[
                "relative w-full overflow-y-auto rounded-t-[24px] bg-white px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4 shadow-2xl xl:max-w-md xl:rounded-[24px] xl:pb-6",
                tall ? "max-h-[85vh]" : "max-h-[70vh]",
            ].join(" ")}>
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#E8E7FB] xl:hidden" />
                {children}
            </div>
        </div>
    );
}

function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                </svg>
            </div>
            <p className="mt-3 text-[13px] font-bold text-[#66739A]">Cargando historial...</p>
        </div>
    );
}

function EmptyState({ filter, search }: { filter: HistoryFilter; search: string }) {
    const msg = search ? "Sin resultados para tu búsqueda" :
        filter === "visited" ? "Sin visitas en este período" :
        filter === "rejected" ? "Sin rechazos en este período" :
        "Sin actividad en este período";
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                <HistoryIcon />
            </div>
            <p className="text-[14px] font-black text-[#101936]">{msg}</p>
            <p className="mt-1 text-[12px] font-semibold text-[#98A2B3]">Cambia el rango de fechas para ver más</p>
        </div>
    );
}

// ── ICONS ────────────────────────────────────────────────────────────────────

const ic = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };

function SearchIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#98A2B3]" {...ic}><path d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /></svg>; }
function FilterIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7C3AED]" {...ic}><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z" /></svg>; }
function PhoneIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.8.4 1.6.7 2.4a2 2 0 0 1-.5 2.1L8.1 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.4.7a2 2 0 0 1 1.7 2Z" /></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" {...ic} /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M20 6 9 17l-5-5" /></svg>; }
function XIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M18 6 6 18M6 6l12 12" /></svg>; }
function UndoIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 2.6-6.36L3 10" /></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#7C3AED]" {...ic}><path d="M12 7v5l3 2" /><path d="M3.05 11a9 9 0 1 1 .5 4M3 15v-4h4" /></svg>; }
function WAIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z"/><path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z"/></svg>; }
function MapsIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>; }
