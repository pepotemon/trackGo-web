"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { getWhatsAppSentIds, markWhatsAppSent } from "@/lib/userContactState";

type Tab = "incomplete" | "not_suitable";

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

// ── localStorage notes ────────────────────────────────────────────────────────

function getNote(leadId: string): string {
    return localStorage.getItem(`lead_note_${leadId}`) ?? "";
}
function saveNote(leadId: string, note: string) {
    note.trim()
        ? localStorage.setItem(`lead_note_${leadId}`, note.trim())
        : localStorage.removeItem(`lead_note_${leadId}`);
}

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

function detectedRows(lead: MetaLeadDoc) {
    return [
        { label: "Nombre", value: lead.name || "" },
        { label: "Negocio", value: lead.business || "" },
        { label: "Telefono", value: lead.phone || "" },
        { label: "Ciudad", value: lead.location?.displayLabel || lead.location?.adminCityLabel || lead.location?.cityLabel || "" },
        { label: "Direccion", value: lead.location?.address || "" },
        { label: "Maps", value: lead.location?.mapsUrl || (lead.location?.lat ? "Ubicacion detectada" : "") },
    ].filter((row) => row.value);
}

function missingFields(lead: MetaLeadDoc) {
    const missing: string[] = [];
    if (!lead.name) missing.push("nombre");
    if (!lead.business) missing.push("tipo de negocio");
    if (!lead.location?.mapsUrl && !lead.location?.lat) missing.push("ubicacion en Maps");
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
    const [waSent, setWaSent] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [dddFilter, setDddFilter] = useState("all");
    const [toast, setToast] = useState("");

    // modals
    const [actionLead, setActionLead] = useState<MetaLeadDoc | null>(null);
    const [actionType, setActionType] = useState<"note" | "not_suitable" | "accept" | "review" | null>(null);
    const [noteText, setNoteText] = useState("");
    const [saving, setSaving] = useState(false);
    const [previewMessages, setPreviewMessages] = useState<LeadMessageDoc[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");

    useEffect(() => {
        if (!phoneCodes.length) { setLoadingIncomplete(false); setLoadingNotSuitable(false); return; }

        setLoadingIncomplete(true);
        const unsubInc = subscribeIncompleteClients(phoneCodes, (data) => {
            setIncomplete(data);
            const noteMap: Record<string, string> = {};
            data.forEach((l) => { const n = getNote(l.id); if (n) noteMap[l.id] = n; });
            setNotes((prev) => ({ ...prev, ...noteMap }));
            setWaSent((prev) => new Set([...prev, ...getWhatsAppSentIds(data.map((lead) => lead.id))]));
            setLoadingIncomplete(false);
        });

        setLoadingNotSuitable(true);
        const unsubNS = subscribeNotSuitableClients(phoneCodes, (data) => {
            setNotSuitable(data);
            setWaSent((prev) => new Set([...prev, ...getWhatsAppSentIds(data.map((lead) => lead.id))]));
            setLoadingNotSuitable(false);
        });

        return () => { unsubInc(); unsubNS(); };
    }, [phoneCodes]);

    useEffect(() => {
        if (actionType !== "review" || !actionLead) {
            setPreviewMessages([]);
            setPreviewError("");
            setPreviewLoading(false);
            return;
        }

        setPreviewLoading(true);
        setPreviewError("");
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

        return unsub;
    }, [actionLead, actionType]);

    const activeList = tab === "incomplete" ? incomplete : notSuitable;
    const loading = tab === "incomplete" ? loadingIncomplete : loadingNotSuitable;

    const activeDdds = useMemo(() => {
        const seen = new Set<string>();
        activeList.forEach((l) => { const d = extractDDD(l.phone); if (d) seen.add(d); });
        return [...seen].sort();
    }, [activeList]);

    // reset ddd filter when switching tabs
    useEffect(() => { setDddFilter("all"); }, [tab]);

    const visible = useMemo(() => {
        let list = activeList;
        if (dddFilter !== "all") list = list.filter((l) => extractDDD(l.phone) === dddFilter);
        if (search.trim()) {
            const q = norm(search.trim());
            list = list.filter((l) =>
                norm(l.business).includes(q) || norm(l.name).includes(q) ||
                norm(l.phone).includes(q) || norm(l.location?.address).includes(q)
            );
        }
        return list;
    }, [activeList, dddFilter, search]);

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

    function openNotSuitable(lead: MetaLeadDoc) { setActionLead(lead); setActionType("not_suitable"); }
    function openAccept(lead: MetaLeadDoc) { setActionLead(lead); setActionType("accept"); }
    function openReview(lead: MetaLeadDoc) { setActionLead(lead); setActionType("review"); }
    function closeAction() {
        setActionLead(null);
        setActionType(null);
        setSaving(false);
        setPreviewMessages([]);
        setPreviewError("");
        setPreviewLoading(false);
    }

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
                await takeIncompleteClient(actionLead.id, userId);
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

    function openWhatsApp(lead: MetaLeadDoc) {
        const msg = isSpanishPhone(lead.phone)
            ? `¡Hola! Somos de Crédito Comercial. Anteriormente nos contactaste sobre la liberación de crédito para tu negocio activo. Solo queremos confirmar si todavía tienes interés. ¡Gracias y disculpa la molestia! 🙏`
            : `Olá! Somos da Crédito Comercial. Você nos contatou anteriormente sobre a liberação de crédito para o seu comércio. Gostaríamos de saber se ainda tem interesse. Obrigado e desculpe o incômodo! 🙏`;
        window.open(buildWALink(lead.phone, msg), "_blank");
        markWhatsAppSent(lead.id);
        setWaSent((prev) => new Set(prev).add(lead.id));
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

            {/* ── HEADER ──────────────────────────────────────────────── */}
            <div className="sticky top-0 z-20 bg-[#fbfaff]/96 px-3 pb-3 pt-4 backdrop-blur-md xl:px-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                            Clientes Incompletos
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
                            onClick={() => setSearchOpen(true)}
                            className="flex h-10 w-10 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Buscar"
                        >
                            <SearchIcon />
                        </button>
                    </div>
                </div>

                {/* TABS */}
                <div className="mb-3 flex gap-1.5">
                    <TabBtn active={tab === "incomplete"} onClick={() => setTab("incomplete")}>
                        Incompletos
                        <CountPill active={tab === "incomplete"}>{incomplete.length}</CountPill>
                    </TabBtn>
                    <TabBtn active={tab === "not_suitable"} onClick={() => setTab("not_suitable")}>
                        No aptos
                        <CountPill active={tab === "not_suitable"}>{notSuitable.length}</CountPill>
                    </TabBtn>
                </div>

                {/* DDD FILTER */}
                {activeDdds.length > 1 ? (
                    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <FilterChip active={dddFilter === "all"} onClick={() => setDddFilter("all")}>
                            Todos <CountPill active={dddFilter === "all"}>{activeList.length}</CountPill>
                        </FilterChip>
                        {activeDdds.map((ddd) => {
                            const cnt = activeList.filter((l) => extractDDD(l.phone) === ddd).length;
                            return (
                                <FilterChip key={ddd} active={dddFilter === ddd} onClick={() => setDddFilter(ddd)}>
                                    {dddCity(ddd)} <CountPill active={dddFilter === ddd}>{cnt}</CountPill>
                                </FilterChip>
                            );
                        })}
                    </div>
                ) : null}
            </div>

            {/* ── LIST ────────────────────────────────────────────────── */}
            <div className="flex-1 px-3 pb-4 pt-2 xl:px-6">
                {loading ? (
                    <LoadingState />
                ) : visible.length === 0 ? (
                    <EmptyState tab={tab} hasSearch={!!search} hasPhoneCodes={phoneCodes.length > 0} />
                ) : (
                    <div className="grid gap-2.5">
                        {visible.map((lead) => (
                            <ClientCard
                                key={lead.id}
                                lead={lead}
                                note={notes[lead.id]}
                                waSent={waSent.has(lead.id)}
                                tab={tab}
                                onWhatsApp={() => openWhatsApp(lead)}
                                onNote={() => openNote(lead)}
                                onNotSuitable={() => openNotSuitable(lead)}
                                onAccept={() => openAccept(lead)}
                                onReview={() => openReview(lead)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* ── SEARCH OVERLAY ──────────────────────────────────────── */}
            {searchOpen ? (
                <div className="fixed inset-0 z-50 flex flex-col bg-[#fbfaff]">
                    <div className="flex items-center gap-3 border-b border-[#E8E7FB] px-4 py-3">
                        <div className="flex flex-1 items-center gap-2 rounded-[14px] border border-[#E8E7FB] bg-white px-3 py-2.5 shadow-sm">
                            <SearchIcon />
                            <input
                                autoFocus
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Negocio, teléfono, dirección..."
                                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-[#101936] outline-none placeholder:text-[#98A2B3]"
                            />
                            {search ? <button type="button" onClick={() => setSearch("")} className="text-[18px] text-[#98A2B3]">×</button> : null}
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
                                        onWhatsApp={() => openWhatsApp(lead)}
                                        onNote={() => { openNote(lead); setSearchOpen(false); }}
                                        onNotSuitable={() => { openNotSuitable(lead); setSearchOpen(false); }}
                                        onAccept={() => { openAccept(lead); setSearchOpen(false); }}
                                        onReview={() => { openReview(lead); setSearchOpen(false); }}
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
                        <p className="mt-2 text-[17px] font-black text-[#101936]">Clientes incompletos y no aptos</p>
                    </div>
                    <div className="space-y-3 text-[12px] font-semibold leading-relaxed text-[#66739A]">
                        <p>
                            Aqui aparecen clientes de tu cobertura que no completaron todo el registro o que el bot marco como no aptos.
                        </p>
                        <p>
                            Puedes escribirles por WhatsApp, agregar una nota y tomar los que tengan potencial para pasarlos a tus prospectos.
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

            {/* ── NOTE MODAL ──────────────────────────────────────────── */}
            {actionType === "note" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <p className="mb-3 text-[15px] font-black text-[#101936]">Nota · {displayName(actionLead)}</p>
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

            {/* ── NO APTO MODAL ───────────────────────────────────────── */}
            {actionType === "review" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2.5 py-1 text-[10px] font-black text-[#7C3AED]">REVISION</span>
                            <p className="mt-2 truncate text-[17px] font-black text-[#101936]">{displayName(actionLead)}</p>
                            <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{actionLead.phone}</p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">Solo lectura</span>
                    </div>

                    <div className="mb-3 grid grid-cols-2 gap-2">
                        {detectedRows(actionLead).map((row) => (
                            <div key={row.label} className="min-w-0 rounded-[12px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-2">
                                <p className="text-[9px] font-black uppercase tracking-[0.06em] text-[#98A2B3]">{row.label}</p>
                                <p className="mt-0.5 truncate text-[12px] font-black text-[#101936]">{row.value}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mb-3 rounded-[14px] border border-amber-100 bg-amber-50 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.06em] text-amber-700">Campos faltantes</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {missingFields(actionLead).length ? missingFields(actionLead).map((field) => (
                                <span key={field} className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-amber-700">{field}</span>
                            )) : (
                                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-emerald-700">Datos principales detectados</span>
                            )}
                        </div>
                    </div>

                    <div className="mb-4 max-h-[34vh] overflow-y-auto rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-3">
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
                            <div className="space-y-2">
                                {previewMessages.map((message) => (
                                    <PreviewMessageBubble key={message.id} message={message} />
                                ))}
                            </div>
                        )}
                    </div>

                    <p className="mb-3 rounded-[14px] border border-violet-100 bg-violet-50 px-3 py-2 text-[11px] font-semibold text-[#5B21FF]">
                        Para responder, primero toma el cliente. Luego lo veras en Prospectos.
                    </p>

                    <button
                        type="button"
                        onClick={confirmAccept}
                        disabled={saving || previewLoading}
                        className="w-full rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white disabled:opacity-60"
                    >
                        {saving ? "Tomando..." : "Tomar cliente"}
                    </button>
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
                        <p className="font-black">⚠ Esta acción es visible para el administrador.</p>
                        <p className="mt-1">El cliente pasará a la base de datos de "No Aptos". Ayudarás al sistema a identificar clientes que no son candidatos válidos en tu zona.</p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={closeAction} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={confirmNotSuitable} disabled={saving} className="flex-1 rounded-[14px] bg-orange-600 py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {saving ? "Guardando..." : "Confirmar No Apto"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {/* ── ACCEPT MODAL ────────────────────────────────────────── */}
            {actionType === "accept" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">ASIGNAR A MÍ</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{displayName(actionLead)}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{actionLead.phone}</p>
                    </div>
                    <p className="mb-4 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-[12px] font-semibold text-emerald-700">
                        Este cliente pasará a tu lista de Prospectos para que lo visites.
                    </p>
                    <div className="flex gap-2">
                        <button type="button" onClick={closeAction} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={confirmAccept} disabled={saving} className="flex-1 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {saving ? "Asignando..." : "Sí, tomar cliente"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}
        </div>
    );
}

// ── CLIENT CARD ───────────────────────────────────────────────────────────────

function ClientCard({
    lead, note, waSent, tab,
    onWhatsApp, onNote, onNotSuitable, onAccept, onReview,
}: {
    lead: MetaLeadDoc;
    note?: string;
    waSent?: boolean;
    tab: Tab;
    onWhatsApp: () => void;
    onNote: () => void;
    onNotSuitable: () => void;
    onAccept: () => void;
    onReview: () => void;
}) {
    const ddd = extractDDD(lead.phone);
    const hasLocation = !!lead.location?.lat;

    return (
        <div className={[
            "overflow-hidden rounded-[18px] border bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]",
            tab === "not_suitable" ? "border-orange-200 bg-orange-50/10" : "border-[#E8E7FB]",
        ].join(" ")}>
            <div className="p-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-black text-[#101936]">{lead.business}</p>
                        {lead.name ? (
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

                {/* Missing location badge */}
                {!hasLocation ? (
                    <div className="mt-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Falta: ubicación
                        </span>
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
                    {tab === "incomplete" ? (
                        <button
                            type="button"
                            onClick={onReview}
                            className="flex h-9 flex-1 items-center justify-center gap-2 rounded-[12px] border border-violet-200 bg-violet-50 text-[12px] font-black text-[#7C3AED] transition active:bg-violet-100"
                        >
                            <ChatIcon /> Revisar
                        </button>
                    ) : (
                        <ActionBtn onClick={onWhatsApp} tone={waSent ? "sent" : "green"} title={waSent ? "Enviado" : "WhatsApp"}>
                            {waSent ? <WACheckIcon /> : <WAIcon />}
                        </ActionBtn>
                    )}
                    <div className="flex-1" />
                    {tab === "incomplete" ? (
                        <ActionBtn onClick={onNotSuitable} tone="gray" title="Marcar no apto"><BanIcon /></ActionBtn>
                    ) : (
                        <button
                            type="button"
                            onClick={onAccept}
                            className="flex h-8 items-center gap-1.5 rounded-[11px] border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700 transition active:bg-emerald-100"
                        >
                            <CheckIcon /> Tomar igual
                        </button>
                    )}
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
function CountPill({ active, children }: { active: boolean; children: React.ReactNode }) {
    return <span className={["flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black", active ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]"].join(" ")}>{children}</span>;
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
function BottomSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-end xl:items-center xl:justify-center">
            <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className="relative w-full overflow-y-auto rounded-t-[24px] bg-white px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4 shadow-2xl xl:max-w-md xl:rounded-[24px] xl:pb-6 max-h-[80vh]">
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
                <svg className="tg-spin h-7 w-7 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3.1-6.8" /></svg>
            </div>
            <p className="mt-3 text-[13px] font-bold text-[#66739A]">Cargando...</p>
        </div>
    );
}
function EmptyState({ tab, hasSearch, hasPhoneCodes }: { tab: Tab; hasSearch: boolean; hasPhoneCodes: boolean }) {
    const msg = hasSearch ? "Sin resultados" :
        tab === "not_suitable" ? "Sin clientes no aptos en tu zona" :
        hasPhoneCodes ? "Sin clientes incompletos en tu zona" : "Sin indicativos configurados";
    const sub = hasSearch ? "Intenta con otro término" :
        tab === "not_suitable" ? "Aquí aparecerán los que marques como No Apto" :
        hasPhoneCodes ? "Solo aparecen clientes con tipo de negocio registrado, sin asignar" : "Contacta al administrador";
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
function PhoneIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.8.4 1.6.7 2.4a2 2 0 0 1-.5 2.1L8.1 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.4.7a2 2 0 0 1 1.7 2Z" /></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" {...ic}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" {...ic} /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M20 6 9 17l-5-5" /></svg>; }
function NoteIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>; }
function BanIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></svg>; }
function WAIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z"/><path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z"/></svg>; }
function WACheckIcon() { return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z"/><path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z"/><path d="m14.5 9-4.5 4.5-2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ClientsIcon({ className }: { className?: string }) { return <svg viewBox="0 0 24 24" className={className} {...ic}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
