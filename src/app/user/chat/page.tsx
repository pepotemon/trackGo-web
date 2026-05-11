"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import {
    dddCity,
    extractDDD,
    markClientNotSuitable,
    subscribeIncompleteClients,
    subscribeNotSuitableClients,
    takeIncompleteClient,
    takeNotSuitableClient,
} from "@/data/incompleteClientsRepo";
import { subscribeLeadMessages } from "@/data/leadChatRepo";
import type { LeadMessageDoc, MetaLeadDoc } from "@/types/leads";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";

type Tab = "incomplete" | "not_suitable";
type RangePreset = "all" | "today" | "week" | "month" | "custom";

// ── localStorage notes ────────────────────────────────────────────────────────

function getNote(leadId: string): string {
    return localStorage.getItem(`lead_note_${leadId}`) ?? "";
}
function saveNote(leadId: string, note: string) {
    if (note.trim()) {
        localStorage.setItem(`lead_note_${leadId}`, note.trim());
    } else {
        localStorage.removeItem(`lead_note_${leadId}`);
    }
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────

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

const PAGE_SIZE = 15;

// ── utils ─────────────────────────────────────────────────────────────────────

function norm(s: unknown) {
    return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function displayName(lead: MetaLeadDoc) {
    return lead.business || lead.name || lead.phone || "Sin nombre";
}
function formatRelative(ts: number | null | undefined): string {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "Ahora";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(new Date(ts));
}

function formatMessageTime(ts: number | null | undefined): string {
    if (!ts) return "";
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function dateKey(date: Date) {
    return date.toISOString().slice(0, 10);
}

function rangeFromPreset(preset: RangePreset, customStart: string, customEnd: string) {
    const now = new Date();
    if (preset === "all") return { startKey: "", endKey: "" };
    if (preset === "today") {
        const key = dateKey(now);
        return { startKey: key, endKey: key };
    }
    if (preset === "week") {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const start = new Date(now);
        start.setDate(now.getDate() + diff);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return { startKey: dateKey(start), endKey: dateKey(end) };
    }
    if (preset === "month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { startKey: dateKey(start), endKey: dateKey(end) };
    }
    return { startKey: customStart, endKey: customEnd };
}

function leadActivityMs(lead: MetaLeadDoc) {
    return lead.lastInboundMessageAt ?? lead.verificationStatusChangedAt ?? lead.updatedAt ?? lead.createdAt ?? null;
}

function leadInDateRange(lead: MetaLeadDoc, startKey: string, endKey: string) {
    if (!startKey && !endKey) return true;
    const ms = leadActivityMs(lead);
    if (!ms) return false;
    const key = dateKey(new Date(ms));
    if (startKey && key < startKey) return false;
    if (endKey && key > endKey) return false;
    return true;
}

function rangeLabel(preset: RangePreset, startKey: string, endKey: string) {
    if (preset === "all") return "Todo";
    if (preset === "today") return "Hoy";
    if (preset === "week") return "Semana";
    if (preset === "month") return "Mes";
    if (startKey && endKey) return `${startKey.slice(5)} - ${endKey.slice(5)}`;
    return "Rango";
}

function reviewClientName(lead: MetaLeadDoc) {
    return lead.name || "Cliente sin nombre";
}

function reviewSummaryRows(lead: MetaLeadDoc) {
    return [
        { label: "Negocio", value: lead.business || "" },
        { label: "Telefono", value: lead.phone || "" },
        { label: "Direccion", value: lead.location?.address || "" },
    ].filter((row) => row.value);
}

function missingFields(lead: MetaLeadDoc) {
    const missing: string[] = [];
    if (!lead.name) missing.push("Falta nombre");
    if (!lead.business) missing.push("Falta negocio");
    if (!lead.location?.mapsUrl && !lead.location?.lat) missing.push("Falta ubicacion Maps");
    return missing;
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function UserIncompleteClientsPage() {
    const { firebaseUser, phoneCodes } = useAuth();
    const userId = firebaseUser?.uid ?? "";

    const [tab, setTab] = useState<Tab>("incomplete");
    const [incomplete, setIncomplete] = useState<MetaLeadDoc[]>([]);
    const [notSuitable, setNotSuitable] = useState<MetaLeadDoc[]>([]);
    const [loadingIncomplete, setLoadingIncomplete] = useState(true);
    const [loadingNotSuitable, setLoadingNotSuitable] = useState(true);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [search, setSearch] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [dddFilter, setDddFilter] = useState("all");
    const [rangePreset, setRangePreset] = useState<RangePreset>("all");
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");
    const [toast, setToast] = useState("");
    const [recoveryClock, setRecoveryClock] = useState(0);

    // modals
    const [actionLead, setActionLead] = useState<MetaLeadDoc | null>(null);
    const [actionType, setActionType] = useState<"note" | "not_suitable" | "review" | null>(null);
    const [noteText, setNoteText] = useState("");
    const [saving, setSaving] = useState(false);
    const [previewMessages, setPreviewMessages] = useState<LeadMessageDoc[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [confirmTakeOpen, setConfirmTakeOpen] = useState(false);

    // pagination
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    // whatsapp
    const [waSent, setWaSent] = useState<Set<string>>(new Set());

    useEffect(() => {
        const timer = window.setInterval(() => setRecoveryClock((value) => value + 1), 5 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!phoneCodes.length) {
            const timer = window.setTimeout(() => {
                setLoadingIncomplete(false);
                setLoadingNotSuitable(false);
            }, 0);
            return () => window.clearTimeout(timer);
        }

        const loadingTimer = window.setTimeout(() => setLoadingIncomplete(true), 0);
        const unsubInc = subscribeIncompleteClients(phoneCodes, (data) => {
            setIncomplete(data);
            const noteMap: Record<string, string> = {};
            data.forEach((l) => { const n = getNote(l.id); if (n) noteMap[l.id] = n; });
            setNotes((prev) => ({ ...prev, ...noteMap }));
            setLoadingIncomplete(false);
        });

        const loadingNotSuitableTimer = window.setTimeout(() => setLoadingNotSuitable(true), 0);
        const unsubNS = subscribeNotSuitableClients(phoneCodes, (data) => {
            setNotSuitable(data);
            setLoadingNotSuitable(false);
        });

        return () => {
            window.clearTimeout(loadingTimer);
            window.clearTimeout(loadingNotSuitableTimer);
            unsubInc();
            unsubNS();
        };
    }, [phoneCodes, recoveryClock]);

    useEffect(() => {
        if (actionType !== "review" || !actionLead) {
            const timer = window.setTimeout(() => {
                setPreviewMessages([]);
                setPreviewError("");
                setPreviewLoading(false);
            }, 0);
            return () => window.clearTimeout(timer);
        }

        const timer = window.setTimeout(() => {
            setPreviewLoading(true);
            setPreviewError("");
        }, 0);
        const unsub = subscribeLeadMessages(
            actionLead.id,
            (messages) => {
                setPreviewMessages(messages);
                setPreviewLoading(false);
            },
            (message) => {
                setPreviewError(message);
                setPreviewLoading(false);
            }
        );

        return () => {
            window.clearTimeout(timer);
            unsub();
        };
    }, [actionLead, actionType]);

    const activeList = tab === "incomplete" ? incomplete : notSuitable;
    const loading = tab === "incomplete" ? loadingIncomplete : loadingNotSuitable;
    const { startKey, endKey } = useMemo(
        () => rangeFromPreset(rangePreset, customStart, customEnd),
        [customEnd, customStart, rangePreset]
    );

    const activeDdds = useMemo(() => {
        const seen = new Set<string>();
        activeList
            .filter((lead) => leadInDateRange(lead, startKey, endKey))
            .forEach((l) => { const d = extractDDD(l.phone); if (d) seen.add(d); });
        return [...seen].sort();
    }, [activeList, endKey, startKey]);

    // reset ddd filter and pagination when switching tabs
    useEffect(() => {
        const timer = window.setTimeout(() => { setDddFilter("all"); setVisibleCount(PAGE_SIZE); }, 0);
        return () => window.clearTimeout(timer);
    }, [tab]);
    useEffect(() => {
        if (dddFilter !== "all" && !activeDdds.includes(dddFilter)) {
            const timer = window.setTimeout(() => setDddFilter("all"), 0);
            return () => window.clearTimeout(timer);
        }
    }, [activeDdds, dddFilter]);

    const visible = useMemo(() => {
        let list = activeList.filter((lead) => leadInDateRange(lead, startKey, endKey));
        if (dddFilter !== "all") list = list.filter((l) => extractDDD(l.phone) === dddFilter);
        if (search.trim()) {
            const q = norm(search.trim());
            list = list.filter((l) =>
                norm(l.business).includes(q) || norm(l.name).includes(q) ||
                norm(l.phone).includes(q) || norm(l.location?.address).includes(q) ||
                norm(l.lastInboundText).includes(q)
            );
        }
        return list;
    }, [activeList, dddFilter, endKey, search, startKey]);

    // reset pagination when filtered list changes
    useEffect(() => {
        const timer = window.setTimeout(() => setVisibleCount(PAGE_SIZE), 0);
        return () => window.clearTimeout(timer);
    }, [dddFilter, startKey, endKey, search]);

    const pagedVisible = tab === "incomplete" ? visible.slice(0, visibleCount) : visible;
    const hasMore = tab === "incomplete" && visible.length > visibleCount;

    // ── actions ───────────────────────────────────────────────────────────────

    function openNote(lead: MetaLeadDoc) {
        setActionLead(lead);
        setNoteText(notes[lead.id] ?? "");
        setActionType("note");
    }
    function saveLeadNote() {
        if (!actionLead) return;
        saveNote(actionLead.id, noteText);
        setNotes((prev) => ({ ...prev, [actionLead.id]: noteText.trim() }));
        closeAction();
    }

    function openWhatsApp(lead: MetaLeadDoc) {
        const msg = isSpanishPhone(lead.phone)
            ? `¡Hola! Somos de Crédito Comercial. Usted nos contactó anteriormente sobre la liberación de crédito para su negocio. Nos gustaría saber si aún tiene interés. ¡Gracias y disculpe la molestia! 🙏`
            : `Olá! Somos da Crédito Comercial. Você nos contatou anteriormente sobre a liberação de crédito para o seu comércio. Gostaríamos de saber se ainda tem interesse. Obrigado e desculpe o incômodo! 🙏`;
        window.open(buildWALink(lead.phone, msg), "_blank");
        setWaSent((prev) => new Set(prev).add(lead.id));
    }

    function openNotSuitable(lead: MetaLeadDoc) { setActionLead(lead); setActionType("not_suitable"); }
    function openReview(lead: MetaLeadDoc) { setActionLead(lead); setActionType("review"); }
    function closeAction() {
        setActionLead(null);
        setActionType(null);
        setSaving(false);
        setPreviewMessages([]);
        setPreviewError("");
        setPreviewLoading(false);
    }
    useBackButtonDismiss(searchOpen, () => setSearchOpen(false));
    useBackButtonDismiss(infoOpen, () => setInfoOpen(false));
    useBackButtonDismiss(filtersOpen, () => setFiltersOpen(false));
    useBackButtonDismiss(Boolean(actionType), closeAction);

    async function confirmNotSuitable() {
        if (!actionLead) return;
        setSaving(true);
        try {
            await markClientNotSuitable(actionLead.id);
            closeAction();
        } catch { setSaving(false); }
    }

    async function confirmAccept() {
        if (!actionLead || !userId) return;
        setSaving(true);
        try {
            // If the client is not_suitable, use takeNotSuitableClient to also reset verificationStatus
            if (actionLead.verificationStatus === "not_suitable") {
                await takeNotSuitableClient(actionLead.id, userId);
            } else {
                await takeIncompleteClient(actionLead.id, userId, {
                    leadName: actionLead.name,
                    leadPhone: actionLead.phone,
                    leadBusiness: actionLead.business,
                });
            }
            setToast("Cliente tomado. Lo encontraras en Prospectos para completar sus datos.");
            window.setTimeout(() => setToast(""), 2600);
            closeAction();
        } catch (error) {
            const message = error instanceof Error && error.message === "client_already_taken"
                ? "Este cliente ya fue tomado por otro usuario."
                : "No se pudo tomar este cliente. Intenta nuevamente.";
            setToast(message);
            window.setTimeout(() => setToast(""), 2800);
            setSaving(false);
        }
    }


    if (!phoneCodes.length && !loadingIncomplete) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-[#fbfaff] px-6 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                    <ClientsIcon className="h-7 w-7 text-[#7C3AED]" />
                </div>
                <p className="text-[15px] font-black text-[#101936]">Sin indicativos configurados</p>
                <p className="mt-2 max-w-xs text-[12px] font-semibold text-[#66739A]">
                    El administrador debe configurar los DDDs de tu cobertura en tu perfil.
                </p>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.07),transparent_36%),linear-gradient(180deg,#fbfaff_0%,#f4f0ff_50%,#fbfaff_100%)]">
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-4 backdrop-blur-md xl:px-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                            Clientes por recuperar
                        </h1>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#66739A]">
                            {phoneCodes.map(dddCity).join(", ")}
                        </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <button
                            type="button"
                            onClick={() => setInfoOpen(true)}
                            className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Informacion"
                        >
                            <span className="text-[15px] font-black">i</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setFiltersOpen(true)}
                            className="relative flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Filtros"
                        >
                            <FilterIcon />
                            {rangePreset !== "all" || dddFilter !== "all" ? (
                                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#7C3AED]" />
                            ) : null}
                        </button>
                        <button
                            type="button"
                            onClick={() => setSearchOpen(true)}
                            className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Buscar"
                        >
                            <SearchIcon />
                        </button>
                    </div>
                </div>

                <div className="mb-3 flex gap-1.5">
                    <TabBtn active={tab === "incomplete"} onClick={() => setTab("incomplete")}>
                        Recuperar
                        <CountPill active={tab === "incomplete"} hasMore={tab === "incomplete" && hasMore}>
                            {incomplete.length}{tab === "incomplete" && hasMore ? "+" : ""}
                        </CountPill>
                    </TabBtn>
                    <TabBtn active={tab === "not_suitable"} onClick={() => setTab("not_suitable")}>
                        No aptos
                        <CountPill active={tab === "not_suitable"}>{notSuitable.length}</CountPill>
                    </TabBtn>
                </div>

                {activeDdds.length > 1 ? (
                    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <FilterChip active={dddFilter === "all"} onClick={() => setDddFilter("all")}>
                            Todos <CountPill active={dddFilter === "all"}>{activeList.filter((lead) => leadInDateRange(lead, startKey, endKey)).length}</CountPill>
                        </FilterChip>
                        {activeDdds.map((ddd) => {
                            const cnt = activeList.filter((l) => leadInDateRange(l, startKey, endKey) && extractDDD(l.phone) === ddd).length;
                            return (
                                <FilterChip key={ddd} active={dddFilter === ddd} onClick={() => setDddFilter(ddd)}>
                                    {dddCity(ddd)} <CountPill active={dddFilter === ddd}>{cnt}</CountPill>
                                </FilterChip>
                            );
                        })}
                    </div>
                ) : null}

                <div className="mt-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <FilterChip active={rangePreset === "all"} onClick={() => setRangePreset("all")}>Todo</FilterChip>
                    <FilterChip active={rangePreset === "today"} onClick={() => setRangePreset("today")}>Hoy</FilterChip>
                    <FilterChip active={rangePreset === "week"} onClick={() => setRangePreset("week")}>Semana</FilterChip>
                    <FilterChip active={rangePreset === "month"} onClick={() => setRangePreset("month")}>Mes</FilterChip>
                    <button
                        type="button"
                        onClick={() => setFiltersOpen(true)}
                        className="shrink-0 rounded-full border border-[#E8E7FB] bg-white px-3 py-1.5 text-[11px] font-black text-[#66739A] shadow-sm"
                    >
                        {rangeLabel(rangePreset, startKey, endKey)}
                    </button>
                </div>
            </div>

            <div className="flex-1 px-3 pb-4 pt-2 xl:px-6">
                {loading ? (
                    <LoadingState />
                ) : visible.length === 0 ? (
                    <EmptyState tab={tab} hasSearch={!!search} hasPhoneCodes={phoneCodes.length > 0} />
                ) : (
                    <>
                        <div className="grid gap-2.5">
                            {pagedVisible.map((lead) => (
                                <ClientCard
                                    key={lead.id}
                                    lead={lead}
                                    note={notes[lead.id]}
                                    tab={tab}
                                    waSent={waSent.has(lead.id)}
                                    onNote={() => openNote(lead)}
                                    onNotSuitable={() => openNotSuitable(lead)}
                                    onReview={() => openReview(lead)}
                                    onWhatsApp={() => openWhatsApp(lead)}
                                />
                            ))}
                        </div>
                        {hasMore ? (
                            <button
                                type="button"
                                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                                className="mt-3 w-full rounded-[14px] border border-[#E8E7FB] bg-white py-3 text-[12px] font-black text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff]"
                            >
                                Cargar más ({visible.length - visibleCount} restantes)
                            </button>
                        ) : null}
                    </>
                )}
            </div>

            {searchOpen ? (
                <div className="fixed inset-0 z-50 flex flex-col bg-[#fbfaff]">
                    <div className="flex items-center gap-3 border-b border-[#E8E7FB] px-4 py-3">
                        <div className="flex flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 py-2.5 shadow-sm">
                            <SearchIcon />
                            <input
                                autoFocus
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Negocio, telefono, mensaje..."
                                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            />
                            {search ? <button type="button" onClick={() => setSearch("")} className="text-[18px] text-[#98A2B3]">x</button> : null}
                        </div>
                        <button type="button" onClick={() => setSearchOpen(false)} className="text-[13px] font-black text-[#7C3AED]">Listo</button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 pt-3">
                        {visible.length === 0 ? (
                            <p className="pt-10 text-center text-[13px] font-semibold text-[#98A2B3]">Sin resultados</p>
                        ) : (
                            <div className="grid gap-2.5">
                                {visible.map((lead) => (
                                    <ClientCard
                                        key={lead.id}
                                        lead={lead}
                                        note={notes[lead.id]}
                                        tab={tab}
                                        waSent={waSent.has(lead.id)}
                                        onNote={() => { openNote(lead); setSearchOpen(false); }}
                                        onNotSuitable={() => { openNotSuitable(lead); setSearchOpen(false); }}
                                        onReview={() => { openReview(lead); setSearchOpen(false); }}
                                        onWhatsApp={() => { openWhatsApp(lead); setSearchOpen(false); }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            {toast ? (
                <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[60] rounded-[16px] border border-[#E8E7FB] bg-white px-4 py-3 text-center text-[12px] font-black text-[#101936] shadow-[0_16px_42px_rgba(91,33,255,0.16)]">
                    {toast}
                </div>
            ) : null}

            {infoOpen ? (
                <BottomSheet onClose={() => setInfoOpen(false)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2.5 py-1 text-[10px] font-black text-[#7C3AED]">AYUDA</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">Clientes por recuperar y no aptos</p>
                    </div>
                    <div className="space-y-3 text-[12px] font-semibold leading-relaxed text-[#66739A]">
                        <p>
                            Aqui aparecen clientes de tu cobertura que no completaron el registro. Si todavia no dejaron negocio, entran despues de 24 horas sin nueva respuesta.
                        </p>
                        <p>
                            Puedes revisar la conversacion, agregar una nota, marcar los que no sirven y tomar los que tengan potencial para pasarlos a Prospectos.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setInfoOpen(false)}
                        className="mt-5 w-full rounded-[14px] bg-[#7C3AED] py-3 text-[13px] font-black text-white"
                    >
                        Entendido
                    </button>
                </BottomSheet>
            ) : null}

            {filtersOpen ? (
                <BottomSheet onClose={() => setFiltersOpen(false)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2.5 py-1 text-[10px] font-black text-[#7C3AED]">FILTROS</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">Filtrar recuperables</p>
                        <p className="mt-1 text-[12px] font-semibold text-[#66739A]">
                            Se muestran clientes incompletos con negocio y clientes sin datos despues de 24 horas sin respuesta.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#98A2B3]">Fecha</p>
                            <div className="grid grid-cols-2 gap-2">
                                {([
                                    { key: "all", label: "Todo" },
                                    { key: "today", label: "Hoy" },
                                    { key: "week", label: "Semana" },
                                    { key: "month", label: "Mes" },
                                ] as { key: RangePreset; label: string }[]).map((item) => (
                                    <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => setRangePreset(item.key)}
                                        className={[
                                            "rounded-[14px] border px-3 py-3 text-[12px] font-black transition",
                                            rangePreset === item.key
                                                ? "border-[#7C3AED] bg-[#7C3AED] text-white"
                                                : "border-[#E8E7FB] bg-white text-[#66739A]",
                                        ].join(" ")}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] p-3">
                            <button
                                type="button"
                                onClick={() => setRangePreset("custom")}
                                className="mb-3 text-[11px] font-black text-[#7C3AED]"
                            >
                                Rango personalizado
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                    <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.06em] text-[#98A2B3]">Desde</span>
                                    <input
                                        type="date"
                                        value={customStart}
                                        onChange={(e) => { setCustomStart(e.target.value); setRangePreset("custom"); }}
                                        className="h-10 w-full rounded-[12px] border border-[#E8E7FB] bg-white px-2 text-[12px] font-bold text-[#101936] outline-none"
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.06em] text-[#98A2B3]">Hasta</span>
                                    <input
                                        type="date"
                                        value={customEnd}
                                        onChange={(e) => { setCustomEnd(e.target.value); setRangePreset("custom"); }}
                                        className="h-10 w-full rounded-[12px] border border-[#E8E7FB] bg-white px-2 text-[12px] font-bold text-[#101936] outline-none"
                                    />
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setRangePreset("all"); setCustomStart(""); setCustomEnd(""); setDddFilter("all"); }}
                            className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]"
                        >
                            Limpiar
                        </button>
                        <button
                            type="button"
                            onClick={() => setFiltersOpen(false)}
                            className="flex-1 rounded-[14px] bg-[#7C3AED] py-3 text-[13px] font-black text-white"
                        >
                            Ver {visible.length}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {actionType === "note" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <p className="mb-3 text-[15px] font-black text-[#101936]">Nota - {displayName(actionLead)}</p>
                    <textarea
                        autoFocus
                        className="w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-2.5 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                        rows={5}
                        placeholder="Escribe una nota para este cliente..."
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                    />
                    <div className="mt-3 flex gap-2">
                        <button type="button" onClick={closeAction} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={saveLeadNote} className="flex-1 rounded-[14px] bg-[#7C3AED] py-3 text-[13px] font-black text-white">Guardar</button>
                    </div>
                </BottomSheet>
            ) : null}

            {actionType === "review" && actionLead ? (
                <BottomSheet onClose={closeAction} fixedFooter={
                    <div>
                        <p className="mb-2 rounded-[14px] border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] font-semibold text-[#5B21FF]">
                            Para responder, primero toma el cliente. Luego lo veras en Prospectos.
                        </p>
                        <button
                            type="button"
                            onClick={() => setConfirmTakeOpen(true)}
                            disabled={saving || previewLoading}
                            className="w-full rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white disabled:opacity-60"
                        >
                            Tomar cliente
                        </button>
                    </div>
                }>
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2 py-0.5 text-[9px] font-black text-[#7C3AED]">REVISION</span>
                                    {missingFields(actionLead).map((field) => (
                                        <span key={field} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700">{field}</span>
                                    ))}
                                </div>
                                <p className="mt-1.5 truncate text-[15px] font-black text-[#101936]">{reviewClientName(actionLead)}</p>
                            </div>
                        </div>

                        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {reviewSummaryRows(actionLead).map((row) => (
                                <div key={row.label} className="min-w-[118px] max-w-[160px] shrink-0 rounded-[11px] border border-[#E8E7FB] bg-[#f8f7ff] px-2.5 py-1.5">
                                    <p className="text-[8px] font-black uppercase tracking-[0.06em] text-[#98A2B3]">{row.label}</p>
                                    <p className="mt-0.5 truncate text-[11px] font-black text-[#101936]">{row.value}</p>
                                </div>
                            ))}
                        </div>

                        <div className="min-h-[260px] flex-1 overflow-y-auto overscroll-contain rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-3">
                            {previewLoading ? (
                                <div className="flex justify-center py-8">
                                    <svg className="tg-spin h-6 w-6 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                                    </svg>
                                </div>
                            ) : previewError ? (
                                <p className="py-6 text-center text-[12px] font-bold text-red-600">{previewError}</p>
                            ) : previewMessages.length === 0 ? (
                                <p className="py-6 text-center text-[12px] font-semibold text-[#98A2B3]">Sin mensajes guardados.</p>
                            ) : (
                                <div className="space-y-2 pb-8">
                                    {previewMessages.map((message) => (
                                        <PreviewMessageBubble key={message.id} message={message} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </BottomSheet>
            ) : null}

            {confirmTakeOpen && actionLead ? (
                <BottomSheet onClose={() => setConfirmTakeOpen(false)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">TOMAR CLIENTE</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{displayName(actionLead)}</p>
                    </div>
                    <div className="mb-4 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-3 text-[12px] font-semibold text-emerald-800">
                        <p className="font-black">Nueva funcion: chat dentro de TrackGo</p>
                        <p className="mt-1">Una vez que tomes este cliente, podras chatear con el directamente desde Prospectos usando el boton <span className="font-black">Chat</span> — sin salir de la app ni abrir WhatsApp.</p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setConfirmTakeOpen(false)} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button
                            type="button"
                            onClick={async () => { setConfirmTakeOpen(false); await confirmAccept(); }}
                            disabled={saving}
                            className="flex-1 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white disabled:opacity-60"
                        >
                            {saving ? "Tomando..." : "Confirmar"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {actionType === "not_suitable" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black text-orange-700">NO APTO</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{displayName(actionLead)}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{actionLead.phone}</p>
                    </div>
                    <div className="mb-4 rounded-[14px] border border-orange-100 bg-orange-50 px-3 py-3 text-[12px] font-semibold text-orange-800">
                        <p className="font-black">Esta accion es visible para el administrador.</p>
                        <p className="mt-1">El cliente pasara a la base de datos de No Aptos. Ayudaras al sistema a identificar clientes que no son candidatos validos en tu zona.</p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={closeAction} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={confirmNotSuitable} disabled={saving} className="flex-1 rounded-[14px] bg-orange-600 py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {saving ? "Guardando..." : "Confirmar No Apto"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

        </div>
    );
}

// ── CLIENT CARD ───────────────────────────────────────────────────────────────

function ClientCard({
    lead, note, tab, waSent,
    onNote, onNotSuitable, onReview, onWhatsApp,
}: {
    lead: MetaLeadDoc;
    note?: string;
    tab: Tab;
    waSent: boolean;
    onNote: () => void;
    onNotSuitable: () => void;
    onReview: () => void;
    onWhatsApp: () => void;
}) {
    const ddd = extractDDD(lead.phone);
    const hasLocation = !!lead.location?.lat;
    const missing = missingFields(lead);

    return (
        <div className={[
            "overflow-hidden rounded-[18px] border bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]",
            tab === "not_suitable" ? "border-orange-200 bg-orange-50/10" : "border-[#E8E7FB]",
        ].join(" ")}>
            <div className="p-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-black text-[#101936]">{displayName(lead)}</p>
                        {lead.name && lead.name !== displayName(lead) ? (
                            <p className="truncate text-[11px] font-semibold text-[#66739A]">{lead.name}</p>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        {ddd ? (
                            <span className="rounded-full bg-[#f3f0ff] px-2 py-0.5 text-[9px] font-black text-[#7C3AED]">
                                {ddd} · {dddCity(ddd)}
                            </span>
                        ) : null}
                        <span className="text-[10px] font-semibold text-[#98A2B3]">{formatRelative(lead.lastInboundMessageAt)}</span>
                    </div>
                </div>

                {/* Info */}
                <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                        <PhoneIcon /> <span className="truncate">{lead.phone}</span>
                    </div>
                    {lead.location?.address ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PinIcon /> <span className="truncate">{lead.location.address}</span>
                        </div>
                    ) : null}
                </div>

                {/* Recovery badges — only falta ubicacion & falta negocio */}
                {(tab === "incomplete" && (!hasLocation || missing.includes("Falta negocio"))) ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {!hasLocation ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Falta: ubicación
                            </span>
                        ) : null}
                        {missing.includes("Falta negocio") ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />Falta: negocio
                            </span>
                        ) : null}
                    </div>
                ) : null}

                {/* Last message */}
                {lead.lastInboundText ? (
                    <p className="mt-2 line-clamp-2 rounded-[10px] border border-[#F2F0FF] bg-[#f8f7ff] px-2.5 py-1.5 text-[11px] font-semibold text-[#66739A]">
                        {lead.lastInboundText}
                    </p>
                ) : null}

                {/* Note */}
                {note ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-[10px] border border-violet-100 bg-violet-50 px-2.5 py-1.5">
                        <NoteIcon />
                        <p className="text-[11px] font-semibold text-[#5B21FF]">{note}</p>
                    </div>
                ) : null}

                {/* Not suitable reason */}
                {tab === "not_suitable" && lead.notSuitableReason ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-[10px] border border-orange-100 bg-orange-50/80 px-2.5 py-1.5">
                        <BanIcon />
                        <p className="text-[11px] font-semibold text-orange-700">{lead.notSuitableReason}</p>
                    </div>
                ) : null}

                {/* Actions */}
                <div className="mt-3 flex items-center gap-1.5 border-t border-[#F2F0FF] pt-2.5">
                    <button
                        type="button"
                        onClick={onReview}
                        className="flex h-9 flex-1 items-center justify-center gap-2 rounded-[12px] border border-violet-200 bg-violet-50 text-[12px] font-black text-[#7C3AED] transition active:bg-violet-100"
                    >
                        <ChatIcon /> Revisar
                    </button>
                    <ActionBtn onClick={onNote} tone="violet" title="Nota"><NoteIcon /></ActionBtn>
                    <ActionBtn onClick={onWhatsApp} tone={waSent ? "sent" : "green"} title={waSent ? "Enviado" : "WhatsApp"}>
                        <WspIcon />
                    </ActionBtn>
                    <div className="flex-1" />
                    {tab === "incomplete" ? (
                        <ActionBtn onClick={onNotSuitable} tone="gray" title="Marcar no apto"><BanIcon /></ActionBtn>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────

function PreviewMessageBubble({ message }: { message: LeadMessageDoc }) {
    const outbound = message.direction === "outbound";
    const sender = message.senderType === "bot" ? "Bot" : message.senderType === "admin" ? "Admin" : "Cliente";

    return (
        <div className={["flex", outbound ? "justify-end" : "justify-start"].join(" ")}>
            <div className={[
                "max-w-[82%] rounded-[15px] px-3 py-2",
                outbound
                    ? "rounded-br-[4px] bg-[#7C3AED] text-white"
                    : "rounded-bl-[4px] border border-[#E8E7FB] bg-white text-[#101936]",
            ].join(" ")}>
                <p className={["mb-0.5 text-[9px] font-black uppercase tracking-wide", outbound ? "text-violet-200" : "text-[#98A2B3]"].join(" ")}>
                    {sender}
                </p>
                <p className="whitespace-pre-wrap text-[12px] font-semibold leading-relaxed">{message.text}</p>
                <p className={["mt-1 text-right text-[9px] font-semibold", outbound ? "text-violet-200" : "text-[#98A2B3]"].join(" ")}>
                    {formatMessageTime(message.createdAt)}
                </p>
            </div>
        </div>
    );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} className={[
            "flex flex-1 items-center justify-center gap-1.5 rounded-[12px] border py-2 text-[12px] font-black transition",
            active ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-[#E8E7FB] bg-white text-[#66739A]",
        ].join(" ")}>
            {children}
        </button>
    );
}
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} className={["flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black transition", active ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-[#E8E7FB] bg-white text-[#66739A]"].join(" ")}>
            {children}
        </button>
    );
}
function CountPill({ active, hasMore, children }: { active: boolean; hasMore?: boolean; children: React.ReactNode }) {
    return (
        <span className={[
            "flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black",
            active ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]",
            hasMore ? "animate-pulse" : "",
        ].join(" ")}>{children}</span>
    );
}
function ActionBtn({ onClick, tone, title, children }: { onClick: () => void; tone: "green" | "violet" | "gray" | "sent"; title: string; children: React.ReactNode }) {
    const cls: Record<string, string> = {
        green: "border-emerald-200 bg-emerald-50 text-emerald-700",
        violet: "border-violet-200 bg-violet-50 text-violet-700",
        gray: "border-[#E8E7FB] bg-white text-[#66739A]",
        sent: "border-emerald-300 bg-emerald-100 text-emerald-700",
    };
    return <button type="button" onClick={onClick} title={title} className={`flex h-8 w-8 items-center justify-center rounded-[11px] border transition active:opacity-70 ${cls[tone]}`}>{children}</button>;
}
function BottomSheet({ children, onClose, fixedFooter }: { children: React.ReactNode; onClose: () => void; fixedFooter?: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 flex items-end xl:items-center xl:justify-center">
            <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className={[
                "relative flex w-full flex-col overflow-hidden rounded-t-[24px] bg-white shadow-2xl xl:max-w-md xl:rounded-[24px]",
                fixedFooter ? "h-[88dvh] max-h-[88dvh] xl:h-[78vh]" : "max-h-[80vh]",
            ].join(" ")}>
                <div className={[
                    "min-h-0 flex-1 px-4 pt-4",
                    fixedFooter ? "flex flex-col overflow-hidden" : "overflow-y-auto",
                ].join(" ")}>
                    <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#E8E7FB] xl:hidden" />
                    {children}
                    {!fixedFooter ? <div className="h-[max(env(safe-area-inset-bottom),1.5rem)]" /> : null}
                </div>
                {fixedFooter ? (
                    <div className="shrink-0 border-t border-[#E8E7FB] bg-white/96 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 shadow-[0_-12px_30px_rgba(16,25,54,0.08)] backdrop-blur-xl">
                        {fixedFooter}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3.1-6.8" /></svg>
            </div>
            <p className="mt-3 text-[13px] font-bold text-[#66739A]">Cargando...</p>
        </div>
    );
}
function EmptyState({ tab, hasSearch, hasPhoneCodes }: { tab: Tab; hasSearch: boolean; hasPhoneCodes: boolean }) {
    const msg = hasSearch ? "Sin resultados" :
        tab === "not_suitable" ? "Sin clientes no aptos en tu zona" :
        hasPhoneCodes ? "Sin clientes por recuperar en tu zona" : "Sin indicativos configurados";
    const sub = hasSearch ? "Intenta con otro término" :
        tab === "not_suitable" ? "Aquí aparecerán los que marques como No Apto" :
        hasPhoneCodes ? "Los clientes sin negocio aparecen despues de 24 horas sin respuesta" : "Contacta al administrador";
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                <ClientsIcon className="h-7 w-7 text-[#7C3AED]" />
            </div>
            <p className="text-[14px] font-black text-[#101936]">{msg}</p>
            <p className="mt-1 max-w-xs text-[12px] font-semibold text-[#98A2B3]">{sub}</p>
        </div>
    );
}

// ── ICONS ─────────────────────────────────────────────────────────────────────

const ic = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
function SearchIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7C3AED]" {...ic}><path d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /></svg>; }
function FilterIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7C3AED]" {...ic}><path d="M4 6h16M7 12h10M10 18h4" /></svg>; }
function PhoneIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.8.4 1.6.7 2.4a2 2 0 0 1-.5 2.1L8.1 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.4.7a2 2 0 0 1 1.7 2Z" /></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" {...ic} /></svg>; }
function NoteIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>; }
function BanIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></svg>; }
function ClientsIcon({ className }: { className?: string }) { return <svg viewBox="0 0 24 24" className={className} {...ic}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
function WspIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>; }
