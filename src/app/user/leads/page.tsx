"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import {
    markLeadRejected,
    markLeadVisited,
    resetLeadPending,
    subscribeUserDailyEvents,
    subscribeUserLeads,
} from "@/data/userLeadsRepo";
import type { MetaLeadDoc } from "@/types/leads";
import type { DailyEventDoc } from "@/types/accounting";
import {
    REJECTED_REASON_LABELS,
    type RejectedReason,
    type UserLeadStats,
} from "@/types/userLeads";

type StatusFilter = "pending" | "visited" | "rejected" | "all";

const SPANISH_PHONE_PREFIXES = ["507","502","503","504","505","506","509","52","54","56","57","51","58","593","591","595","598"];
function isSpanishPhone(phone: string) {
    const d = phone.replace(/\D/g, "");
    return SPANISH_PHONE_PREFIXES.some(p => d.startsWith(p));
}
function buildWALink(phone: string, msg: string) {
    const d = phone.replace(/\D/g, "");
    const intl = d.startsWith("55") || SPANISH_PHONE_PREFIXES.some(p => d.startsWith(p)) ? d : `55${d}`;
    return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
}

const REJECTION_REASONS = Object.entries(REJECTED_REASON_LABELS) as [RejectedReason, string][];

function todayKey() { return new Date().toISOString().slice(0, 10); }

function weekRange(): { startKey: string; endKey: string } {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0,0,0,0);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return {
        startKey: mon.toISOString().slice(0, 10),
        endKey: sun.toISOString().slice(0, 10),
    };
}

function displayName(lead: MetaLeadDoc) {
    return lead.name || lead.business || lead.phone || "Sin nombre";
}

function norm(s: unknown) {
    return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function formatAssignedAt(ts: number | null | undefined): string {
    if (!ts) return "";
    return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

export default function UserLeadsPage() {
    const { firebaseUser, profile } = useAuth();
    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<StatusFilter>("pending");
    const [search, setSearch] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);

    const [actionLead, setActionLead] = useState<MetaLeadDoc | null>(null);
    const [actionType, setActionType] = useState<"visit" | "reject" | null>(null);
    const [rejectStep, setRejectStep] = useState<1 | 2>(1);
    const [rejectReason, setRejectReason] = useState<RejectedReason | null>(null);
    const [rejectText, setRejectText] = useState("");
    const [saving, setSaving] = useState(false);

    const userId = firebaseUser?.uid ?? "";
    const userName = profile?.name?.split(" ")[0] ?? "Vendedor";

    useEffect(() => {
        if (!userId) return;
        setLoading(true);
        const unsub = subscribeUserLeads(userId, (data) => {
            setLeads(data);
            setLoading(false);
        });
        return unsub;
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        const { startKey, endKey } = weekRange();
        const unsub = subscribeUserDailyEvents(userId, startKey, endKey, setEvents);
        return unsub;
    }, [userId]);

    const stats = useMemo<UserLeadStats>(() => {
        const today = todayKey();
        const todayEvents = events.filter((e) => e.dayKey === today);
        return {
            todayVisited: todayEvents.filter((e) => e.type === "visited").length,
            todayRejected: todayEvents.filter((e) => e.type === "rejected").length,
            weekVisited: events.filter((e) => e.type === "visited").length,
            weekRejected: events.filter((e) => e.type === "rejected").length,
        };
    }, [events]);

    const counts = useMemo(() => ({
        pending: leads.filter((l) => !l.status || l.status === "pending").length,
        visited: leads.filter((l) => l.status === "visited").length,
        rejected: leads.filter((l) => l.status === "rejected").length,
        all: leads.length,
    }), [leads]);

    const visibleLeads = useMemo(() => {
        let list = leads;
        if (filter === "pending") list = list.filter((l) => !l.status || l.status === "pending");
        else if (filter === "visited") list = list.filter((l) => l.status === "visited");
        else if (filter === "rejected") list = list.filter((l) => l.status === "rejected");

        if (search.trim()) {
            const q = norm(search.trim());
            list = list.filter((l) =>
                norm(l.name).includes(q) ||
                norm(l.business).includes(q) ||
                norm(l.phone).includes(q) ||
                norm(l.location.address).includes(q) ||
                norm(l.location.displayLabel).includes(q)
            );
        }
        return list;
    }, [leads, filter, search]);

    // ── Actions ─────────────────────────────────────────────────────────

    function openVisit(lead: MetaLeadDoc) { setActionLead(lead); setActionType("visit"); }
    function openReject(lead: MetaLeadDoc) {
        setActionLead(lead); setActionType("reject");
        setRejectStep(1); setRejectReason(null); setRejectText("");
    }
    function closeAction() { setActionLead(null); setActionType(null); setSaving(false); }

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
        const today = todayKey();
        const statusAt = lead.status === "visited" || lead.status === "rejected" ? (lead as any).statusAt : null;
        if (statusAt) {
            const actionDay = new Date(statusAt).toISOString().slice(0, 10);
            if (actionDay !== today) return;
        }
        await resetLeadPending(lead, userId);
    }

    function openWhatsApp(lead: MetaLeadDoc) {
        const msg = isSpanishPhone(lead.phone)
            ? `¡Buenas tardes! Somos de Crédito Comercial. Nos comunicamos para continuar con la liberación del crédito y el registro de tu negocio. ¡Quedamos atentos! 😊`
            : `Boa tarde! Somos da Crédito Comercial. Estamos entrando em contato para dar continuidade à liberação do crédito e realização do cadastro. Aguardamos seu retorno! 😊`;
        window.open(buildWALink(lead.phone, msg), "_blank");
    }

    function openMaps(lead: MetaLeadDoc) {
        const url = lead.location.mapsUrl || `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}`;
        window.open(url, "_blank");
    }

    const today = todayKey();

    function canUndo(lead: MetaLeadDoc) {
        if (lead.status !== "visited" && lead.status !== "rejected") return false;
        const statusAt = (lead as any).statusAt as number | null;
        if (!statusAt) return true;
        return new Date(statusAt).toISOString().slice(0, 10) === today;
    }

    return (
        <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.08),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f6f3ff_52%,#f8fafc_100%)]">

            {/* ── STICKY HEADER ───────────────────────────────────────── */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-4 backdrop-blur-md xl:px-6">

                {/* GREETING + SEARCH */}
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                            Hola, <span className="text-[#7C3AED]">{userName}</span>
                        </h1>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#66739A]">
                            {new Intl.DateTimeFormat("es", { weekday: "long", day: "2-digit", month: "long" }).format(new Date())}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSearchOpen(true)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                        aria-label="Buscar"
                    >
                        <SearchIcon />
                    </button>
                </div>

                {/* STATS ROW */}
                <div className="mb-3 grid grid-cols-4 gap-2">
                    <StatPill label="Hoy visit." value={stats.todayVisited} tone="green" />
                    <StatPill label="Hoy rech." value={stats.todayRejected} tone="red" />
                    <StatPill label="Sem. visit." value={stats.weekVisited} tone="green" />
                    <StatPill label="Sem. rech." value={stats.weekRejected} tone="red" />
                </div>

                {/* FILTER TABS */}
                <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {(["pending", "visited", "rejected", "all"] as StatusFilter[]).map((f) => {
                        const labels: Record<StatusFilter, string> = { pending: "Pendientes", visited: "Visitados", rejected: "Rechazados", all: "Todos" };
                        const count = counts[f];
                        const active = filter === f;
                        return (
                            <button
                                key={f}
                                type="button"
                                onClick={() => setFilter(f)}
                                className={[
                                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black transition",
                                    active
                                        ? "border-[#7C3AED] bg-[#7C3AED] text-white"
                                        : "border-[#E8E7FB] bg-white text-[#66739A] hover:border-[#7C3AED]/40 hover:text-[#7C3AED]",
                                ].join(" ")}
                            >
                                {labels[f]}
                                <span className={[
                                    "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black",
                                    active ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]",
                                ].join(" ")}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── LEAD LIST ───────────────────────────────────────────── */}
            <div className="flex-1 px-3 pt-2 pb-4 xl:px-6">
                {loading ? (
                    <LoadingState />
                ) : visibleLeads.length === 0 ? (
                    <EmptyState filter={filter} search={search} />
                ) : (
                    <div className="grid gap-2.5">
                        {visibleLeads.map((lead, idx) => {
                            const isPending = !lead.status || lead.status === "pending";
                            const priority = isPending ? visibleLeads.filter((l) => !l.status || l.status === "pending").indexOf(lead) : -1;
                            return (
                                <LeadCard
                                    key={lead.id}
                                    lead={lead}
                                    priority={priority >= 0 && priority < 3 ? priority + 1 : null}
                                    canUndo={canUndo(lead)}
                                    onVisit={() => openVisit(lead)}
                                    onReject={() => openReject(lead)}
                                    onUndo={() => handleUndo(lead)}
                                    onWhatsApp={() => openWhatsApp(lead)}
                                    onMaps={() => openMaps(lead)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── SEARCH MODAL ────────────────────────────────────────── */}
            {searchOpen ? (
                <div className="fixed inset-0 z-50 flex flex-col bg-[#fbfaff]">
                    <div className="flex items-center gap-3 border-b border-[#E8E7FB] px-4 py-3">
                        <div className="flex flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 py-2.5 shadow-sm">
                            <SearchIcon />
                            <input
                                autoFocus
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Nombre, negocio, teléfono..."
                                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            />
                            {search ? (
                                <button type="button" onClick={() => setSearch("")} className="text-[18px] text-[#98A2B3]">×</button>
                            ) : null}
                        </div>
                        <button type="button" onClick={() => setSearchOpen(false)} className="text-[13px] font-black text-[#7C3AED]">
                            Listo
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 pt-3">
                        {visibleLeads.length === 0 ? (
                            <p className="pt-10 text-center text-[13px] font-semibold text-[#98A2B3]">Sin resultados</p>
                        ) : (
                            <div className="grid gap-2.5">
                                {visibleLeads.map((lead) => (
                                    <LeadCard
                                        key={lead.id}
                                        lead={lead}
                                        priority={null}
                                        canUndo={canUndo(lead)}
                                        onVisit={() => { openVisit(lead); setSearchOpen(false); }}
                                        onReject={() => { openReject(lead); setSearchOpen(false); }}
                                        onUndo={() => handleUndo(lead)}
                                        onWhatsApp={() => openWhatsApp(lead)}
                                        onMaps={() => openMaps(lead)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            {/* ── VISIT MODAL ─────────────────────────────────────────── */}
            {actionType === "visit" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <div className="mb-4">
                        <div className="mb-1 flex items-center gap-2">
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
                        <div className="mb-1 flex items-center gap-2">
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
                                    onClick={() => rejectReason === "otro" ? setRejectStep(2) : (rejectReason && setRejectStep(2))}
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
        </div>
    );
}

// ── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function LeadCard({
    lead,
    priority,
    canUndo,
    onVisit,
    onReject,
    onUndo,
    onWhatsApp,
    onMaps,
}: {
    lead: MetaLeadDoc;
    priority: number | null;
    canUndo: boolean;
    onVisit: () => void;
    onReject: () => void;
    onUndo: () => void;
    onWhatsApp: () => void;
    onMaps: () => void;
}) {
    const isPending = !lead.status || lead.status === "pending";
    const isVisited = lead.status === "visited";
    const isRejected = lead.status === "rejected";

    return (
        <div className={[
            "overflow-hidden rounded-[18px] border bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]",
            isVisited ? "border-emerald-200 bg-emerald-50/30" : isRejected ? "border-red-200 bg-red-50/30" : "border-[#E8E7FB]",
        ].join(" ")}>
            <div className="p-3">
                {/* ── HEADER ── */}
                <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        {priority ? (
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7C3AED] text-[10px] font-black text-white">
                                {priority}
                            </span>
                        ) : null}
                        <div className="min-w-0">
                            <p className="truncate text-[14px] font-black text-[#101936]">
                                {displayName(lead)}
                            </p>
                            {lead.business && lead.name ? (
                                <p className="truncate text-[11px] font-semibold text-[#66739A]">{lead.business}</p>
                            ) : null}
                        </div>
                    </div>
                    <StatusBadge status={lead.status} />
                </div>

                {/* ── DETAILS ── */}
                <div className="mt-2 space-y-1">
                    {lead.phone ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PhoneIcon />
                            <span className="truncate">{lead.phone}</span>
                        </div>
                    ) : null}
                    {lead.location.address ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PinIcon />
                            <span className="truncate">{lead.location.address}</span>
                        </div>
                    ) : lead.location.displayLabel ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PinIcon />
                            <span className="truncate">{lead.location.displayLabel}</span>
                        </div>
                    ) : null}
                    {lead.assignedAt ? (
                        <p className="text-[10px] font-semibold text-[#98A2B3]">Asignado: {formatAssignedAt(lead.assignedAt)}</p>
                    ) : null}
                </div>

                {/* ── ACTIONS ── */}
                <div className="mt-3 flex items-center gap-2 border-t border-[#F2F0FF] pt-2.5">
                    {/* Quick actions */}
                    <div className="flex gap-1.5">
                        <ActionBtn onClick={onWhatsApp} title="WhatsApp" tone="green">
                            <WAIcon />
                        </ActionBtn>
                        <ActionBtn onClick={onMaps} title="Maps" tone="blue">
                            <MapsIcon />
                        </ActionBtn>
                    </div>

                    <div className="flex-1" />

                    {/* Status actions */}
                    {isPending ? (
                        <div className="flex gap-1.5">
                            <button
                                type="button"
                                onClick={onReject}
                                className="flex h-8 items-center gap-1.5 rounded-[11px] border border-red-200 bg-red-50 px-2.5 text-[11px] font-black text-red-600 transition active:bg-red-100"
                            >
                                <XIcon /> Rechazar
                            </button>
                            <button
                                type="button"
                                onClick={onVisit}
                                className="flex h-8 items-center gap-1.5 rounded-[11px] border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700 transition active:bg-emerald-100"
                            >
                                <CheckIcon /> Visité
                            </button>
                        </div>
                    ) : canUndo ? (
                        <button
                            type="button"
                            onClick={onUndo}
                            className="flex h-8 items-center gap-1.5 rounded-[11px] border border-[#E8E7FB] bg-white px-2.5 text-[11px] font-black text-[#66739A] transition active:bg-[#f3f0ff]"
                        >
                            <UndoIcon /> Deshacer
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status?: string }) {
    if (!status || status === "pending") return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Pendiente</span>
    );
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
            "rounded-[12px] border px-1.5 py-1.5 text-center",
            tone === "green" ? "border-emerald-100 bg-emerald-50" : "border-red-100 bg-red-50",
        ].join(" ")}>
            <div className={["text-[15px] font-black", tone === "green" ? "text-emerald-700" : "text-red-700"].join(" ")}>{value}</div>
            <div className="mt-0.5 text-[9px] font-black text-[#98A2B3] leading-none">{label}</div>
        </div>
    );
}

function ActionBtn({ onClick, title, tone, children }: { onClick: () => void; title: string; tone: "green" | "blue"; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={[
                "flex h-8 w-8 items-center justify-center rounded-[11px] border transition active:opacity-70",
                tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700",
            ].join(" ")}
        >
            {children}
        </button>
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
            <p className="mt-3 text-[13px] font-bold text-[#66739A]">Cargando prospectos...</p>
        </div>
    );
}

function EmptyState({ filter, search }: { filter: StatusFilter; search: string }) {
    const msg = search ? "Sin resultados para tu búsqueda" :
        filter === "pending" ? "No tienes prospectos pendientes" :
        filter === "visited" ? "No has visitado prospectos esta semana" :
        filter === "rejected" ? "No has rechazado prospectos" :
        "No tienes prospectos asignados";
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                <InboxIcon />
            </div>
            <p className="text-[14px] font-black text-[#101936]">{msg}</p>
            <p className="mt-1 text-[12px] font-semibold text-[#98A2B3]">Aparecerán aquí cuando se asignen</p>
        </div>
    );
}

// ── ICONS ────────────────────────────────────────────────────────────────────

const ic = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };

function SearchIcon() {
    return <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7C3AED]" {...ic}><path d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /></svg>;
}
function PhoneIcon() {
    return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.8.4 1.6.7 2.4a2 2 0 0 1-.5 2.1L8.1 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.4.7a2 2 0 0 1 1.7 2Z" /></svg>;
}
function PinIcon() {
    return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" {...ic} /></svg>;
}
function WAIcon() {
    return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z"/><path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z"/></svg>;
}
function MapsIcon() {
    return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></svg>;
}
function CheckIcon() {
    return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M20 6 9 17l-5-5" /></svg>;
}
function XIcon() {
    return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function UndoIcon() {
    return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 2.6-6.36L3 10" /></svg>;
}
function InboxIcon() {
    return <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#7C3AED]" {...ic}><path d="M4 4h16l-2 9H6L4 4Z" /><path d="M6 13v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" /></svg>;
}
