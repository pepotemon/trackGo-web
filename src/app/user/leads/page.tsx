"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import {
    markLeadRejected,
    markLeadVisited,
    resetLeadPending,
    subscribeUserDailyEvents,
    subscribeUserLeads,
} from "@/data/userLeadsRepo";
import { takeIncompleteClient, subscribeIncompleteClients, markClientNotSuitable, dddCity, extractDDD } from "@/data/incompleteClientsRepo";
import type { MetaLeadDoc, LeadMessageDoc } from "@/types/leads";
import type { DailyEventDoc } from "@/types/accounting";
import { subscribeLeadMessages } from "@/data/leadChatRepo";
import {
    REJECTED_REASON_LABELS,
    type RejectedReason,
    type UserLeadStats,
} from "@/types/userLeads";
import { getWhatsAppSentIds, markWhatsAppSent } from "@/lib/userContactState";
import { useBackButtonDismiss } from "@/hooks/useBackButtonDismiss";
import { useWhatsAppDailyLimit } from "@/hooks/useWhatsAppDailyLimit";
import { WhatsAppLimitModal } from "@/components/WhatsAppLimitModal";
import { useVendorSubscriptionStatus, type VendorSubscriptionStatus } from "@/features/subscriptions/useVendorSubscriptionStatus";
import { useUserCampaignIds } from "@/features/subscriptions/useUserCampaignIds";

type StatusFilter = "pending" | "visited" | "rejected" | "all";
type MainTab = "verificados" | "no_verificados";

const INC_PAGE_SIZE = 15;

const SPANISH_3DIGIT_CC = ["507","502","503","504","505","506","509","593","591","595","598"];
const SPANISH_PHONE_PREFIXES = [...SPANISH_3DIGIT_CC, "52","54","56","57","51","58"];
function isSpanishPhone(phone: string) {
    const d = phone.replace(/\D/g, "");
    if (SPANISH_PHONE_PREFIXES.some(p => d.startsWith(p))) return true;
    // Handle numbers stored with erroneous "55" prefix over a Spanish country code
    if (d.startsWith("55") && SPANISH_3DIGIT_CC.some(cc => d.slice(2).startsWith(cc))) return true;
    return false;
}
function buildWALink(phone: string, msg: string) {
    const d = phone.replace(/\D/g, "");
    if (SPANISH_PHONE_PREFIXES.some(p => d.startsWith(p))) return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
    if (d.startsWith("55")) {
        const stripped = d.slice(2);
        // Strip erroneous "55" prefix if what follows is a 3-digit Spanish country code
        if (SPANISH_3DIGIT_CC.some(cc => stripped.startsWith(cc))) return `https://wa.me/${stripped}?text=${encodeURIComponent(msg)}`;
        return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
    }
    return `https://wa.me/55${d}?text=${encodeURIComponent(msg)}`;
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

function dayKeyFromMs(value?: number | null): string {
    if (!value) return "";
    return new Date(value).toISOString().slice(0, 10);
}

function leadRangeKey(lead: MetaLeadDoc): string {
    if (lead.status === "visited" || lead.status === "rejected") {
        return dayKeyFromMs(lead.statusAt);
    }
    return typeof lead.assignedDayKey === "string" ? lead.assignedDayKey : dayKeyFromMs(lead.assignedAt);
}

function leadInRange(lead: MetaLeadDoc, startKey: string, endKey: string) {
    const key = leadRangeKey(lead);
    if (!key) return false;
    return key >= startKey && key <= endKey;
}

function isPendingLead(lead: MetaLeadDoc) {
    return !lead.status || lead.status === "pending";
}

function leadQueueTime(lead: MetaLeadDoc) {
    return lead.assignedAt || lead.createdAt || lead.updatedAt || 0;
}

function leadVisibleInWorkRange(lead: MetaLeadDoc, startKey: string, endKey: string) {
    if (isPendingLead(lead)) return true;
    return leadInRange(lead, startKey, endKey);
}

function getNote(leadId: string): string {
    return localStorage.getItem(`lead_note_${leadId}`) ?? "";
}
function saveNote(leadId: string, note: string) {
    note.trim()
        ? localStorage.setItem(`lead_note_${leadId}`, note.trim())
        : localStorage.removeItem(`lead_note_${leadId}`);
}

function isCampaignClient(lead: MetaLeadDoc, campaignIds: string[]): boolean {
    return campaignIds.length > 0 && !!lead.leadAcquisitionCampaignId && campaignIds.includes(lead.leadAcquisitionCampaignId);
}

export default function UserLeadsPage() {
    const { firebaseUser, profile, userPermissions, phoneCodes } = useAuth();
    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [events, setEvents] = useState<DailyEventDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<StatusFilter>("pending");
    const [search, setSearch] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [waSent, setWaSent] = useState<Set<string>>(new Set());
    const [copiedLeadId, setCopiedLeadId] = useState<string | null>(null);
    const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [filtersOpen, setFiltersOpen] = useState(false);
    const [waConfirmLead, setWaConfirmLead] = useState<MetaLeadDoc | null>(null);

    const [actionLead, setActionLead] = useState<MetaLeadDoc | null>(null);
    const [actionType, setActionType] = useState<"visit" | "reject" | "note" | "manage" | null>(null);
    const [noteText, setNoteText] = useState("");
    const [rejectStep, setRejectStep] = useState<1 | 2>(1);
    const [rejectReason, setRejectReason] = useState<RejectedReason | null>(null);
    const [rejectText, setRejectText] = useState("");
    const [saving, setSaving] = useState(false);

    const { triggerWa, showModal: waLimitOpen, countAtWarning: waLimitCount, confirmWa, cancelWa } = useWhatsAppDailyLimit();

    // Main tab
    const [mainTab, setMainTab] = useState<MainTab>("verificados");

    // Recovery (No verificados) state
    const [incomplete, setIncomplete] = useState<MetaLeadDoc[]>([]);
    const [loadingIncomplete, setLoadingIncomplete] = useState(false);
    const [incDddFilter, setIncDddFilter] = useState("all");
    const [incNotes, setIncNotes] = useState<Record<string, string>>({});
    const [incWaSent, setIncWaSent] = useState<Set<string>>(new Set());
    const [incCopiedId, setIncCopiedId] = useState<string | null>(null);
    const incCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [waTakeLead, setWaTakeLead] = useState<MetaLeadDoc | null>(null);
    const [waTaking, setWaTaking] = useState(false);
    const [confirmTakeLead, setConfirmTakeLead] = useState<MetaLeadDoc | null>(null);
    const [takeSaving, setTakeSaving] = useState(false);
    const [incRecoveryClock, setIncRecoveryClock] = useState(0);
    const [incVisibleCount, setIncVisibleCount] = useState(INC_PAGE_SIZE);
    const [notSuitableLead, setNotSuitableLead] = useState<MetaLeadDoc | null>(null);
    const [notSuitableSaving, setNotSuitableSaving] = useState(false);
    const [campaignManaging, setCampaignManaging] = useState<string | null>(null);
    const [toast, setToast] = useState("");
    const [showNoVerifAnnouncement, setShowNoVerifAnnouncement] = useState(false);
    const [reviewIncLead, setReviewIncLead] = useState<MetaLeadDoc | null>(null);
    const [reviewIncMessages, setReviewIncMessages] = useState<LeadMessageDoc[]>([]);
    const [reviewIncLoading, setReviewIncLoading] = useState(false);
    const [reviewIncError, setReviewIncError] = useState("");

    const userId = firebaseUser?.uid ?? "";
    const userName = profile?.name?.split(" ")[0] ?? "Vendedor";
    const activeWeek = useMemo(() => weekRange(), []);
    const subscriptionStatus = useVendorSubscriptionStatus(userPermissions.canSeeSubscriptions ? userId : null);
    const { campaignIds, loading: campaignIdsLoading } = useUserCampaignIds(userId);

    useEffect(() => {
        if (userPermissions.canSeeUnverifiedClients && !localStorage.getItem("tg_seen_noverif_v1")) {
            setShowNoVerifAnnouncement(true);
        }
    }, [userPermissions.canSeeUnverifiedClients]);

    useEffect(() => {
        return () => {
            if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
        };
    }, []);

    useEffect(() => {
        if (!userId) return;
        setLoading(true);
        const unsub = subscribeUserLeads(userId, (data) => {
            setLeads(data);
            const noteMap: Record<string, string> = {};
            data.forEach((l) => { const n = getNote(l.id); if (n) noteMap[l.id] = n; });
            setNotes((prev) => ({ ...prev, ...noteMap }));
            setWaSent((prev) => new Set([...prev, ...getWhatsAppSentIds(data.map((lead) => lead.id))]));
            setLoading(false);
        });
        return unsub;
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        const { startKey, endKey } = activeWeek;
        const unsub = subscribeUserDailyEvents(userId, startKey, endKey, setEvents);
        return unsub;
    }, [activeWeek, userId]);

    // Recovery subscription (No verificados tab)
    useEffect(() => {
        // Wait for campaignIds to resolve before subscribing — avoids briefly showing
        // DDD-based clients when the vendor actually has active campaigns.
        if (campaignIdsLoading) return;
        if (!phoneCodes.length && !campaignIds.length) {
            setLoadingIncomplete(false);
            return;
        }
        setLoadingIncomplete(true);
        const unsub = subscribeIncompleteClients(phoneCodes, (data) => {
            setIncomplete(data);
            const noteMap: Record<string, string> = {};
            data.forEach((l) => { const n = getNote(l.id); if (n) noteMap[l.id] = n; });
            setIncNotes((prev) => ({ ...prev, ...noteMap }));
            const ids = data.map((l) => l.id);
            setIncWaSent((prev) => new Set([...prev, ...getWhatsAppSentIds(ids)]));
            setLoadingIncomplete(false);
        }, campaignIds);
        return unsub;
    }, [phoneCodes, campaignIds, campaignIdsLoading, incRecoveryClock]);

    // Recovery clock (refresh every 5 min)
    useEffect(() => {
        const timer = window.setInterval(() => setIncRecoveryClock((c) => c + 1), 5 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!reviewIncLead) {
            setReviewIncMessages([]);
            setReviewIncError("");
            setReviewIncLoading(false);
            return;
        }
        setReviewIncLoading(true);
        setReviewIncError("");
        return subscribeLeadMessages(
            reviewIncLead.id,
            (messages) => { setReviewIncMessages(messages); setReviewIncLoading(false); },
            (msg) => { setReviewIncError(msg); setReviewIncLoading(false); }
        );
    }, [reviewIncLead]);

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

    const counts = useMemo(() => {
        const inVerificados = (lead: MetaLeadDoc) =>
            !(lead.leadAcquisitionCampaignId && campaignIds.includes(lead.leadAcquisitionCampaignId) && !lead.takenFromIncompleteAt);
        return {
            pending: leads.filter((l) => isPendingLead(l) && inVerificados(l)).length,
            visited: leads.filter((l) => l.status === "visited" && leadInRange(l, activeWeek.startKey, activeWeek.endKey) && inVerificados(l)).length,
            rejected: leads.filter((l) => l.status === "rejected" && leadInRange(l, activeWeek.startKey, activeWeek.endKey) && inVerificados(l)).length,
            all: leads.filter((l) => leadVisibleInWorkRange(l, activeWeek.startKey, activeWeek.endKey) && inVerificados(l)).length,
        };
    }, [activeWeek, leads, campaignIds]);

    const visibleLeads = useMemo(() => {
        let list = leads.filter((lead) => {
            if (!leadVisibleInWorkRange(lead, activeWeek.startKey, activeWeek.endKey)) return false;
            // Auto-assigned campaign leads that the vendor hasn't acted on yet belong in
            // "No verificados" (CampaignLeadCard). Exclude them from "Verificados" until
            // takeIncompleteClient sets takenFromIncompleteAt.
            if (
                lead.leadAcquisitionCampaignId &&
                campaignIds.includes(lead.leadAcquisitionCampaignId) &&
                !lead.takenFromIncompleteAt
            ) return false;
            return true;
        });
        if (filter === "pending") list = list.filter(isPendingLead);
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

        if (filter === "pending") {
            list = [...list].sort((a, b) => leadQueueTime(a) - leadQueueTime(b));
        }

        return list;
    }, [activeWeek, leads, filter, search, campaignIds]);

    const incActiveDdds = useMemo(() => {
        const seen = new Set<string>();
        incomplete.forEach((l) => { const d = extractDDD(l.phone); if (d) seen.add(d); });
        return [...seen].sort();
    }, [incomplete]);

    const incVisible = useMemo(() => {
        let list = incomplete;
        if (incDddFilter !== "all") list = list.filter((l) => extractDDD(l.phone) === incDddFilter);
        if (search.trim()) {
            const q = norm(search.trim());
            list = list.filter((l) =>
                norm(l.business).includes(q) || norm(l.name).includes(q) ||
                norm(l.phone).includes(q) || norm(l.leadAcquisitionCityLabel).includes(q)
            );
        }
        return list;
    }, [incomplete, incDddFilter, search]);

    const searchList = mainTab === "verificados" ? visibleLeads : incVisible;

    // ── Actions ─────────────────────────────────────────────────────────

    function openVisit(lead: MetaLeadDoc) { setActionLead(lead); setActionType("visit"); }
    function openManage(lead: MetaLeadDoc) { setActionLead(lead); setActionType("manage"); }
    function openReject(lead: MetaLeadDoc) {
        setActionLead(lead); setActionType("reject");
        setRejectStep(1); setRejectReason(null); setRejectText("");
    }
    function manageVisit() { setActionType("visit"); }
    function manageReject() {
        setActionType("reject");
        setRejectStep(1);
        setRejectReason(null);
        setRejectText("");
    }
    function openNoteAction(lead: MetaLeadDoc) {
        setActionLead(lead);
        setNoteText(notes[lead.id] ?? "");
        setActionType("note");
    }
    function closeAction() { setActionLead(null); setActionType(null); setSaving(false); }
    useBackButtonDismiss(searchOpen, () => setSearchOpen(false));
    useBackButtonDismiss(filtersOpen, () => setFiltersOpen(false));
    useBackButtonDismiss(Boolean(waConfirmLead), () => setWaConfirmLead(null));
    useBackButtonDismiss(Boolean(actionType), closeAction);
    useBackButtonDismiss(Boolean(waTakeLead), () => setWaTakeLead(null));
    useBackButtonDismiss(Boolean(confirmTakeLead), () => setConfirmTakeLead(null));
    useBackButtonDismiss(Boolean(reviewIncLead), () => setReviewIncLead(null));
    useBackButtonDismiss(Boolean(notSuitableLead), () => setNotSuitableLead(null));

    // Tab change: reset search, ddd filter and pagination
    useEffect(() => {
        setSearch("");
        setIncDddFilter("all");
        setIncVisibleCount(INC_PAGE_SIZE);
    }, [mainTab]);

    // Reset pagination when filters/search change in No verificados
    useEffect(() => {
        setIncVisibleCount(INC_PAGE_SIZE);
    }, [incDddFilter, search]);

    function showToast(msg: string) {
        setToast(msg);
        window.setTimeout(() => setToast(""), 2600);
    }

    async function confirmTakeClient(lead: MetaLeadDoc) {
        if (!userId) return;
        setTakeSaving(true);
        try {
            await takeIncompleteClient(lead.id, userId, {
                leadName: lead.name,
                leadPhone: lead.phone,
                leadBusiness: lead.business,
            });
            setConfirmTakeLead(null);
            setTakeSaving(false);
            showToast("Cliente tomado. Lo verás en Verificados.");
        } catch (error) {
            setConfirmTakeLead(null);
            setTakeSaving(false);
            showToast(
                error instanceof Error && error.message === "client_already_taken"
                    ? "Este cliente ya fue tomado por otro usuario."
                    : "No se pudo tomar este cliente. Intenta nuevamente."
            );
        }
    }

    async function confirmTakeAndWa() {
        if (!waTakeLead || !userId) return;
        setWaTaking(true);
        const lead = waTakeLead;
        try {
            await takeIncompleteClient(lead.id, userId, {
                leadName: lead.name,
                leadPhone: lead.phone,
                leadBusiness: lead.business,
            });
            setWaTakeLead(null);
            setWaTaking(false);
            const msg = isSpanishPhone(lead.phone)
                ? `¡Hola! Somos de Crédito Comercial. Usted nos contactó anteriormente sobre la liberación de crédito para su negocio. Nos gustaría saber si aún tiene interés. ¡Gracias y disculpe la molestia! 🙏`
                : `Olá! Somos da Crédito Comercial. Você nos contatou anteriormente sobre a liberação de crédito para o seu comércio. Gostaríamos de saber se ainda tem interesse. Obrigado e desculpe o incômodo! 🙏`;
            triggerWa(() => {
                window.open(buildWALink(lead.phone, msg), "_blank");
                markWhatsAppSent(lead.id);
                setIncWaSent((prev) => new Set(prev).add(lead.id));
            });
            showToast("Cliente tomado. Lo verás en Verificados.");
        } catch (error) {
            setWaTakeLead(null);
            setWaTaking(false);
            showToast(
                error instanceof Error && error.message === "client_already_taken"
                    ? "Este cliente ya fue tomado por otro usuario."
                    : "No se pudo tomar este cliente."
            );
        }
    }

    async function confirmNotSuitable() {
        if (!notSuitableLead) return;
        setNotSuitableSaving(true);
        try {
            await markClientNotSuitable(notSuitableLead.id);
            setNotSuitableLead(null);
        } catch { /* noop */ }
        setNotSuitableSaving(false);
    }

    async function openCampaignManage(lead: MetaLeadDoc) {
        if (!userId) return;
        setCampaignManaging(lead.id);
        try {
            await takeIncompleteClient(lead.id, userId, {
                leadName: lead.name,
                leadPhone: lead.phone,
                leadBusiness: lead.business,
            });
        } catch (error) {
            setCampaignManaging(null);
            showToast(
                error instanceof Error && error.message === "client_already_taken"
                    ? "Este cliente ya fue tomado por otro usuario."
                    : "No se pudo procesar este cliente."
            );
            return;
        }
        setCampaignManaging(null);
        setActionLead(lead);
        setActionType("manage");
    }

    async function openCampaignWhatsApp(lead: MetaLeadDoc) {
        if (!userId) return;
        setCampaignManaging(lead.id);
        try {
            await takeIncompleteClient(lead.id, userId, {
                leadName: lead.name,
                leadPhone: lead.phone,
                leadBusiness: lead.business,
            });
        } catch (error) {
            setCampaignManaging(null);
            showToast(
                error instanceof Error && error.message === "client_already_taken"
                    ? "Este cliente ya fue tomado por otro usuario."
                    : "No se pudo procesar este cliente."
            );
            return;
        }
        setCampaignManaging(null);
        const msg = isSpanishPhone(lead.phone)
            ? `¡Hola! Somos de Crédito Comercial. Usted nos contactó anteriormente sobre la liberación de crédito para su negocio. Nos gustaría saber si aún tiene interés. ¡Gracias y disculpe la molestia! 🙏`
            : `Olá! Somos da Crédito Comercial. Você nos contatou anteriormente sobre a liberação de crédito para o seu comércio. Gostaríamos de saber se ainda tem interesse. Obrigado e desculpe o incômodo! 🙏`;
        triggerWa(() => {
            window.open(buildWALink(lead.phone, msg), "_blank");
            markWhatsAppSent(lead.id);
            setIncWaSent((prev) => new Set(prev).add(lead.id));
        });
        showToast("Cliente añadido a Verificados.");
    }

    function openCampaignNoteAction(lead: MetaLeadDoc) {
        setActionLead(lead);
        setNoteText(incNotes[lead.id] ?? getNote(lead.id));
        setActionType("note");
    }

    async function openCampaignVisit(lead: MetaLeadDoc) {
        if (!userId) return;
        setCampaignManaging(lead.id);
        try {
            await takeIncompleteClient(lead.id, userId, {
                leadName: lead.name,
                leadPhone: lead.phone,
                leadBusiness: lead.business,
            });
        } catch (error) {
            setCampaignManaging(null);
            showToast(
                error instanceof Error && error.message === "client_already_taken"
                    ? "Este cliente ya fue tomado por otro usuario."
                    : "No se pudo procesar este cliente."
            );
            return;
        }
        setCampaignManaging(null);
        setActionLead(lead);
        setActionType("visit");
    }

    async function openCampaignReject(lead: MetaLeadDoc) {
        if (!userId) return;
        setCampaignManaging(lead.id);
        try {
            await takeIncompleteClient(lead.id, userId, {
                leadName: lead.name,
                leadPhone: lead.phone,
                leadBusiness: lead.business,
            });
        } catch (error) {
            setCampaignManaging(null);
            showToast(
                error instanceof Error && error.message === "client_already_taken"
                    ? "Este cliente ya fue tomado por otro usuario."
                    : "No se pudo procesar este cliente."
            );
            return;
        }
        setCampaignManaging(null);
        setRejectStep(1);
        setRejectReason(null);
        setActionLead(lead);
        setActionType("reject");
    }

    async function copyIncLead(lead: MetaLeadDoc) {
        const mapsUrl = lead.location?.mapsUrl || (
            lead.location?.lat != null && lead.location?.lng != null
                ? `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}` : ""
        );
        const text = [
            lead.name ? `Nombre: ${lead.name}` : "",
            lead.phone ? `Telefono: ${lead.phone}` : "",
            lead.business ? `Negocio: ${lead.business}` : "",
            lead.location?.address ? `Direccion: ${lead.location.address}` : "",
            mapsUrl ? `Maps: ${mapsUrl}` : "",
        ].filter(Boolean).join("\n");
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            window.prompt("Copia los datos del cliente", text);
        }
        setIncCopiedId(lead.id);
        if (incCopyTimer.current) clearTimeout(incCopyTimer.current);
        incCopyTimer.current = setTimeout(() => setIncCopiedId(null), 1200);
    }

    function saveLeadNote() {
        if (!actionLead) return;
        saveNote(actionLead.id, noteText);
        setNotes((prev) => ({ ...prev, [actionLead.id]: noteText.trim() }));
        setIncNotes((prev) => ({ ...prev, [actionLead.id]: noteText.trim() }));
        closeAction();
    }

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
        setWaConfirmLead(lead);
    }

    function confirmWhatsApp() {
        if (!waConfirmLead) return;
        const lead = waConfirmLead;
        const msg = isSpanishPhone(lead.phone)
            ? `¡Buenas tardes! Somos de Crédito Comercial. Nos comunicamos para continuar con la liberación del crédito y el registro de tu negocio. ¡Quedamos atentos! 😊`
            : `Boa tarde! Somos da Crédito Comercial. Estamos entrando em contato para dar continuidade à liberação do crédito e realização do cadastro. Aguardamos seu retorno! 😊`;
        setWaConfirmLead(null);
        triggerWa(() => {
            window.open(buildWALink(lead.phone, msg), "_blank");
            markWhatsAppSent(lead.id);
            setWaSent((prev) => new Set(prev).add(lead.id));
        });
    }

    function openMaps(lead: MetaLeadDoc) {
        const url = lead.location.mapsUrl || `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}`;
        window.open(url, "_blank");
    }

    async function copyLead(lead: MetaLeadDoc) {
        const mapsUrl = lead.location.mapsUrl || (
            lead.location.lat !== null && lead.location.lng !== null
                ? `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}`
                : ""
        );
        const text = [
            lead.name ? `Nombre: ${lead.name}` : "",
            lead.phone ? `Telefono: ${lead.phone}` : "",
            lead.business ? `Negocio: ${lead.business}` : "",
            lead.location.address ? `Direccion: ${lead.location.address}` : "",
            mapsUrl ? `Maps: ${mapsUrl}` : "",
        ].filter(Boolean).join("\n");

        try {
            await navigator.clipboard.writeText(text);
        } catch {
            window.prompt("Copia los datos del cliente", text);
        }

        setCopiedLeadId(lead.id);
        if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
        copyToastTimer.current = setTimeout(() => setCopiedLeadId(null), 1200);
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

                {/* GREETING + ACTIONS */}
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-[20px] font-black tracking-[-0.03em] text-[#101936]">
                            Hola, <span className="text-[#7C3AED]">{userName}</span>
                        </h1>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <span>{new Intl.DateTimeFormat("es", { weekday: "long", day: "2-digit", month: "long" }).format(new Date())}</span>
                            <span>·</span>
                            <span>
                                <span className={stats.weekVisited > 0 ? "font-black text-emerald-600" : "font-black text-amber-600"}>
                                    {stats.weekVisited}
                                </span>
                                <span className="text-[#98A2B3]">/{counts.all} sem.</span>
                            </span>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {userPermissions.canSeeSubscriptions ? <HeaderSubscriptionBadge status={subscriptionStatus} /> : null}
                        {mainTab === "verificados" ? (
                            <button
                                type="button"
                                onClick={() => setFiltersOpen(true)}
                                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                                aria-label="Filtrar"
                            >
                                <FilterIcon />
                                {filter !== "pending" ? (
                                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#7C3AED]" />
                                ) : null}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => setSearchOpen(true)}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-[#E8E7FB] bg-white shadow-sm transition active:bg-[#f3f0ff]"
                            aria-label="Buscar"
                        >
                            <SearchIcon />
                        </button>
                    </div>
                </div>

                {/* MAIN TABS */}
                <div className={["mb-2 gap-1.5", userPermissions.canSeeUnverifiedClients ? "grid grid-cols-2" : "flex"].join(" ")}>
                    <button
                        type="button"
                        onClick={() => setMainTab("verificados")}
                        className={["flex items-center justify-center gap-1.5 rounded-[12px] border py-2 text-[12px] font-black transition",
                            userPermissions.canSeeUnverifiedClients ? "" : "flex-1",
                            mainTab === "verificados" ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-[#E8E7FB] bg-white text-[#66739A]",
                        ].join(" ")}
                    >
                        Verificados
                        <span className={["flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black",
                            mainTab === "verificados" ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]",
                        ].join(" ")}>{counts.all}</span>
                    </button>
                    {userPermissions.canSeeUnverifiedClients ? (
                        <button
                            type="button"
                            onClick={() => setMainTab("no_verificados")}
                            className={["flex items-center justify-center gap-1.5 rounded-[12px] border py-2 text-[12px] font-black transition",
                                mainTab === "no_verificados" ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-[#E8E7FB] bg-white text-[#66739A]",
                            ].join(" ")}
                        >
                            No verificados
                            <span className={["flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black",
                                mainTab === "no_verificados" ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]",
                            ].join(" ")}>{incomplete.length}</span>
                        </button>
                    ) : null}
                </div>

                {/* DDD chips - only for No verificados when multiple DDDs */}
                {mainTab === "no_verificados" && incActiveDdds.length > 1 ? (
                    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <FilterChip active={incDddFilter === "all"} onClick={() => setIncDddFilter("all")}>
                            Todos <CountPill active={incDddFilter === "all"}>{incomplete.length}</CountPill>
                        </FilterChip>
                        {incActiveDdds.map((ddd) => {
                            const cnt = incomplete.filter((l) => extractDDD(l.phone) === ddd).length;
                            return (
                                <FilterChip key={ddd} active={incDddFilter === ddd} onClick={() => setIncDddFilter(ddd)}>
                                    {dddCity(ddd)} <CountPill active={incDddFilter === ddd}>{cnt}</CountPill>
                                </FilterChip>
                            );
                        })}
                    </div>
                ) : null}

            </div>

            {/* ── CONTENT ─────────────────────────────────────────────── */}
            <div className="flex-1 px-3 pt-2 pb-4 xl:px-6">
                {mainTab === "verificados" ? (
                    loading ? <LoadingState /> :
                    visibleLeads.length === 0 ? <EmptyState filter={filter} search={search} /> :
                    <div className="grid gap-2.5">
                        {visibleLeads.map((lead) => {
                            const isPending = !lead.status || lead.status === "pending";
                            const priority = isPending ? visibleLeads.filter((l) => !l.status || l.status === "pending").indexOf(lead) : -1;
                            return (
                                <LeadCard
                                    key={lead.id}
                                    lead={lead}
                                    note={notes[lead.id]}
                                    waSent={waSent.has(lead.id)}
                                    copied={copiedLeadId === lead.id}
                                    priority={priority >= 0 && priority < 3 ? priority + 1 : null}
                                    canUndo={canUndo(lead)}
                                    onManage={() => openManage(lead)}
                                    onUndo={() => handleUndo(lead)}
                                    onWhatsApp={() => openWhatsApp(lead)}
                                    onMaps={() => openMaps(lead)}
                                    onCopy={() => copyLead(lead)}
                                    onNote={() => openNoteAction(lead)}
                                    canChatWithProspects={userPermissions.canChatWithProspects}
                                />
                            );
                        })}
                    </div>
                ) : (
                    loadingIncomplete ? <LoadingState /> :
                    !phoneCodes.length && !campaignIds.length ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                                <InboxIcon />
                            </div>
                            <p className="text-[14px] font-black text-[#101936]">Sin cobertura configurada</p>
                            <p className="mt-1 text-[12px] font-semibold text-[#98A2B3]">El administrador debe configurar los indicativos o activar una suscripción</p>
                        </div>
                    ) :
                    incVisible.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f0ff]">
                                <InboxIcon />
                            </div>
                            <p className="text-[14px] font-black text-[#101936]">
                                {search ? "Sin resultados" : "Sin clientes por verificar"}
                            </p>
                            <p className="mt-1 text-[12px] font-semibold text-[#98A2B3]">
                                {search ? "Intenta con otro término" : "Los clientes incompletos aparecerán aquí"}
                            </p>
                        </div>
                    ) :
                    <div className="grid gap-2.5">
                        {incVisible.slice(0, incVisibleCount).map((lead) => {
                            const mapsUrl = lead.location?.mapsUrl || (lead.location?.lat != null ? `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}` : "");
                            return isCampaignClient(lead, campaignIds) ? (
                                <CampaignLeadCard
                                    key={lead.id}
                                    lead={lead}
                                    note={incNotes[lead.id]}
                                    waSent={incWaSent.has(lead.id)}
                                    copied={incCopiedId === lead.id}
                                    managing={campaignManaging === lead.id}
                                    onVisit={() => void openCampaignVisit(lead)}
                                    onReject={() => void openCampaignReject(lead)}
                                    onReview={() => setReviewIncLead(lead)}
                                    onNotSuitable={() => setNotSuitableLead(lead)}
                                    onWhatsApp={() => void openCampaignWhatsApp(lead)}
                                    onMaps={mapsUrl ? () => window.open(mapsUrl, "_blank") : undefined}
                                    onCopy={() => void copyIncLead(lead)}
                                    onNote={() => openCampaignNoteAction(lead)}
                                />
                            ) : (
                                <RecoveryCard
                                    key={lead.id}
                                    lead={lead}
                                    note={incNotes[lead.id]}
                                    waSent={incWaSent.has(lead.id)}
                                    copied={incCopiedId === lead.id}
                                    onTake={() => setConfirmTakeLead(lead)}
                                    onReview={() => setReviewIncLead(lead)}
                                    onNotSuitable={() => setNotSuitableLead(lead)}
                                    onWhatsApp={() => setWaTakeLead(lead)}
                                    onMaps={mapsUrl ? () => window.open(mapsUrl, "_blank") : () => {}}
                                    onCopy={() => void copyIncLead(lead)}
                                />
                            );
                        })}
                        {incVisible.length > incVisibleCount ? (
                            <button
                                type="button"
                                onClick={() => setIncVisibleCount((n) => n + INC_PAGE_SIZE)}
                                className="w-full rounded-[14px] border border-[#E8E7FB] bg-white py-3 text-[12px] font-black text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff]"
                            >
                                Cargar más ({incVisible.length - incVisibleCount} restantes)
                            </button>
                        ) : null}
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
                        {searchList.length === 0 ? (
                            <p className="pt-10 text-center text-[13px] font-semibold text-[#98A2B3]">Sin resultados</p>
                        ) : (
                            <div className="grid gap-2.5">
                                {mainTab === "verificados" ? searchList.map((lead) => (
                                    <LeadCard
                                        key={lead.id}
                                        lead={lead}
                                        note={notes[lead.id]}
                                        waSent={waSent.has(lead.id)}
                                        copied={copiedLeadId === lead.id}
                                        priority={null}
                                        canUndo={canUndo(lead)}
                                        onManage={() => { openManage(lead); setSearchOpen(false); }}
                                        onUndo={() => handleUndo(lead)}
                                        onWhatsApp={() => openWhatsApp(lead)}
                                        onMaps={() => openMaps(lead)}
                                        onCopy={() => copyLead(lead)}
                                        onNote={() => { openNoteAction(lead); setSearchOpen(false); }}
                                        canChatWithProspects={userPermissions.canChatWithProspects}
                                    />
                                )) : searchList.map((lead) => {
                                    const mapsUrl = lead.location?.mapsUrl || (lead.location?.lat != null ? `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}` : "");
                                    return isCampaignClient(lead, campaignIds) ? (
                                        <CampaignLeadCard
                                            key={lead.id}
                                            lead={lead}
                                            note={incNotes[lead.id]}
                                            waSent={incWaSent.has(lead.id)}
                                            copied={incCopiedId === lead.id}
                                            managing={campaignManaging === lead.id}
                                            onVisit={() => { void openCampaignVisit(lead); setSearchOpen(false); }}
                                            onReject={() => { void openCampaignReject(lead); setSearchOpen(false); }}
                                            onReview={() => { setReviewIncLead(lead); setSearchOpen(false); }}
                                            onNotSuitable={() => { setNotSuitableLead(lead); setSearchOpen(false); }}
                                            onWhatsApp={() => { void openCampaignWhatsApp(lead); setSearchOpen(false); }}
                                            onMaps={mapsUrl ? () => window.open(mapsUrl, "_blank") : undefined}
                                            onCopy={() => void copyIncLead(lead)}
                                            onNote={() => { openCampaignNoteAction(lead); setSearchOpen(false); }}
                                        />
                                    ) : (
                                        <RecoveryCard
                                            key={lead.id}
                                            lead={lead}
                                            note={incNotes[lead.id]}
                                            waSent={incWaSent.has(lead.id)}
                                            copied={incCopiedId === lead.id}
                                            onTake={() => { setConfirmTakeLead(lead); setSearchOpen(false); }}
                                            onReview={() => { setReviewIncLead(lead); setSearchOpen(false); }}
                                            onNotSuitable={() => { setNotSuitableLead(lead); setSearchOpen(false); }}
                                            onWhatsApp={() => { setWaTakeLead(lead); setSearchOpen(false); }}
                                            onMaps={mapsUrl ? () => window.open(mapsUrl, "_blank") : () => {}}
                                            onCopy={() => void copyIncLead(lead)}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            {/* ── FILTER MODAL ────────────────────────────────────────── */}
            {filtersOpen ? (
                <BottomSheet onClose={() => setFiltersOpen(false)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2.5 py-1 text-[10px] font-black text-[#7C3AED]">FILTRAR</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">Ver prospectos</p>
                    </div>
                    <div className="grid gap-2">
                        {(["pending", "visited", "rejected", "all"] as StatusFilter[]).map((f) => {
                            const labels: Record<StatusFilter, string> = { pending: "Pendientes", visited: "Visitados", rejected: "Rechazados", all: "Todos" };
                            const descs: Record<StatusFilter, string> = { pending: "Sin gestionar esta semana", visited: "Marcados como visitados", rejected: "Cerrados con motivo", all: "Todos los asignados" };
                            const active = filter === f;
                            return (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => { setFilter(f); setFiltersOpen(false); }}
                                    className={[
                                        "flex items-center justify-between rounded-[16px] border px-4 py-3 text-left transition",
                                        active ? "border-[#7C3AED] bg-[#f3f0ff]" : "border-[#E8E7FB] bg-white active:bg-[#f8f7ff]",
                                    ].join(" ")}
                                >
                                    <span>
                                        <span className={["block text-[14px] font-black", active ? "text-[#7C3AED]" : "text-[#101936]"].join(" ")}>{labels[f]}</span>
                                        <span className="block text-[11px] font-semibold text-[#66739A]">{descs[f]}</span>
                                    </span>
                                    <span className={["flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-black", active ? "bg-[#7C3AED] text-white" : "bg-[#f3f0ff] text-[#7C3AED]"].join(" ")}>
                                        {counts[f]}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </BottomSheet>
            ) : null}

            {/* ── WHATSAPP CONFIRM MODAL ───────────────────────────────── */}
            {waConfirmLead ? (
                <BottomSheet onClose={() => setWaConfirmLead(null)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">WHATSAPP</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{displayName(waConfirmLead)}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{waConfirmLead.phone}</p>
                    </div>
                    <p className="mb-4 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-[12px] font-semibold text-emerald-700">
                        ¿Confirmas que vas a enviar el mensaje de WhatsApp a este prospecto?
                    </p>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setWaConfirmLead(null)} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">
                            Cancelar
                        </button>
                        <button type="button" onClick={confirmWhatsApp} className="flex-1 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white">
                            Sí, enviar
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {actionType === "manage" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2.5 py-1 text-[10px] font-black text-[#7C3AED]">GESTIONAR</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{displayName(actionLead)}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{actionLead.phone}</p>
                    </div>
                    <div className="grid gap-2">
                        <button
                            type="button"
                            onClick={manageVisit}
                            className="flex items-center justify-between rounded-[16px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-left transition active:bg-emerald-100"
                        >
                            <span>
                                <span className="block text-[14px] font-black text-emerald-700">Visitado</span>
                                <span className="block text-[11px] font-semibold text-emerald-600/80">Registrar visita del cliente</span>
                            </span>
                            <CheckIcon />
                        </button>
                        <button
                            type="button"
                            onClick={manageReject}
                            className="flex items-center justify-between rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-left transition active:bg-red-100"
                        >
                            <span>
                                <span className="block text-[14px] font-black text-red-600">Rechazado</span>
                                <span className="block text-[11px] font-semibold text-red-500/80">Cerrar con motivo operativo</span>
                            </span>
                            <XIcon />
                        </button>
                    </div>
                </BottomSheet>
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

            {/* ── NOTE MODAL ──────────────────────────────────────────── */}
            {actionType === "note" && actionLead ? (
                <BottomSheet onClose={closeAction}>
                    <p className="mb-3 text-[15px] font-black text-[#101936]">Nota · {displayName(actionLead)}</p>
                    <textarea
                        autoFocus
                        className="w-full rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-2.5 text-[13px] font-semibold text-[#101936] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-violet-100"
                        rows={5}
                        placeholder="Escribe una nota para este prospecto..."
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                    />
                    <div className="mt-3 flex gap-2">
                        <button type="button" onClick={closeAction} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={saveLeadNote} className="flex-1 rounded-[14px] bg-[#7C3AED] py-3 text-[13px] font-black text-white">Guardar</button>
                    </div>
                </BottomSheet>
            ) : null}

            {waLimitOpen ? (
                <WhatsAppLimitModal count={waLimitCount} onConfirm={confirmWa} onCancel={cancelWa} />
            ) : null}

            {/* PASAR A VERIFICADOS modal */}
            {confirmTakeLead ? (
                <BottomSheet onClose={() => setConfirmTakeLead(null)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">PASAR A VERIFICADOS</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{displayName(confirmTakeLead)}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{confirmTakeLead.phone}</p>
                    </div>
                    <div className="mb-4 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-3 text-[12px] font-semibold text-emerald-800">
                        <p className="font-black">Este cliente pasará a tus Verificados</p>
                        <p className="mt-1">Podrás gestionarlo desde la pestaña Verificados y ningún otro vendedor podrá tomarlo.</p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setConfirmTakeLead(null)} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={() => void confirmTakeClient(confirmTakeLead)} disabled={takeSaving} className="flex-1 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {takeSaving ? "Guardando..." : "Confirmar"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {/* CONTACTAR (WhatsApp + take) modal */}
            {waTakeLead ? (
                <BottomSheet onClose={() => setWaTakeLead(null)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">CONTACTAR</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{displayName(waTakeLead)}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{waTakeLead.phone}</p>
                    </div>
                    <div className="mb-4 rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-3 text-[12px] font-semibold text-emerald-800">
                        <p className="font-black">Para contactar, primero debes tomar el cliente</p>
                        <p className="mt-1">Al tomarlo pasará a Verificados y WhatsApp se abrirá automáticamente.</p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setWaTakeLead(null)} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={() => void confirmTakeAndWa()} disabled={waTaking} className="flex-1 rounded-[14px] bg-emerald-600 py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {waTaking ? "Tomando..." : "Tomar y contactar"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {/* ONE-TIME ANNOUNCEMENT: No verificados tab */}
            {showNoVerifAnnouncement ? (
                <BottomSheet onClose={() => { localStorage.setItem("tg_seen_noverif_v1", "1"); setShowNoVerifAnnouncement(false); }}>
                    <div className="mb-5">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">NOVEDAD</span>
                        <p className="mt-3 text-[19px] font-black leading-snug tracking-[-0.02em] text-[#101936]">
                            Tus clientes por recuperar ahora están aquí
                        </p>
                        <p className="mt-1.5 text-[13px] font-semibold text-[#66739A]">
                            Los encontrás en la pestaña <span className="font-black text-[#7C3AED]">No verificados</span>, justo al lado de tus Prospectos.
                        </p>
                    </div>
                    <div className="space-y-3 text-[13px] font-semibold text-[#66739A]">
                        <div className="flex items-start gap-3 rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3.5 py-3">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-black text-[#7C3AED]">1</span>
                            <p>Tocá <span className="font-black text-[#101936]">No verificados</span> para ver los clientes que aún no completaron su registro.</p>
                        </div>
                        <div className="flex items-start gap-3 rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3.5 py-3">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-black text-[#7C3AED]">2</span>
                            <p>Podés ver el <span className="font-black text-[#101936]">chat del bot</span> con cada cliente antes de decidir si te interesa.</p>
                        </div>
                        <div className="flex items-start gap-3 rounded-[14px] border border-[#E8E7FB] bg-[#f8f7ff] px-3.5 py-3">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-black text-[#7C3AED]">3</span>
                            <p>Si te interesa, tocá <span className="font-black text-[#101936]">Pasar a Verificados</span> y el cliente pasa directamente a tus Prospectos.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => { localStorage.setItem("tg_seen_noverif_v1", "1"); setShowNoVerifAnnouncement(false); }}
                        className="mt-5 w-full rounded-[14px] bg-[#7C3AED] py-3.5 text-[14px] font-black text-white"
                    >
                        Entendido
                    </button>
                </BottomSheet>
            ) : null}

            {/* VER CHAT (read-only) for No verificados */}
            {reviewIncLead ? (
                <BottomSheet onClose={() => setReviewIncLead(null)} tall>
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <span className="inline-flex items-center rounded-full bg-[#f3f0ff] px-2 py-0.5 text-[9px] font-black text-[#7C3AED]">CHAT</span>
                            <p className="mt-1.5 truncate text-[15px] font-black text-[#101936]">
                                {reviewIncLead.business || reviewIncLead.name || reviewIncLead.phone || "Sin nombre"}
                            </p>
                            <p className="text-[11px] font-semibold text-[#66739A]">{reviewIncLead.phone}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => { const lead = reviewIncLead; setReviewIncLead(null); setConfirmTakeLead(lead); }}
                            className="shrink-0 rounded-[11px] bg-emerald-600 px-3 py-2 text-[11px] font-black text-white"
                        >
                            Tomar
                        </button>
                    </div>
                    <div className="min-h-[260px] overflow-y-auto rounded-[16px] border border-[#E8E7FB] bg-[#f8f7ff] px-3 py-3">
                        {reviewIncLoading ? (
                            <div className="flex justify-center py-8">
                                <svg className="tg-spin h-6 w-6 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                                </svg>
                            </div>
                        ) : reviewIncError ? (
                            <p className="py-6 text-center text-[12px] font-bold text-red-600">{reviewIncError}</p>
                        ) : reviewIncMessages.length === 0 ? (
                            <p className="py-6 text-center text-[12px] font-semibold text-[#98A2B3]">Sin mensajes guardados.</p>
                        ) : (
                            <div className="space-y-2 pb-4">
                                {reviewIncMessages.map((message) => (
                                    <IncMessageBubble key={message.id} message={message} />
                                ))}
                            </div>
                        )}
                    </div>
                </BottomSheet>
            ) : null}

            {/* NO APTO modal */}
            {notSuitableLead ? (
                <BottomSheet onClose={() => setNotSuitableLead(null)}>
                    <div className="mb-4">
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black text-orange-700">NO APTO</span>
                        <p className="mt-2 text-[17px] font-black text-[#101936]">{notSuitableLead.business || notSuitableLead.name || notSuitableLead.phone || "Sin nombre"}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{notSuitableLead.phone}</p>
                    </div>
                    <div className="mb-4 rounded-[14px] border border-orange-100 bg-orange-50 px-3 py-3 text-[12px] font-semibold text-orange-800">
                        <p className="font-black">Este cliente pasará a No Aptos</p>
                        <p className="mt-1">Quedará registrado como no apto y desaparecerá de los No verificados.</p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setNotSuitableLead(null)} className="flex-1 rounded-[14px] border border-[#E8E7FB] py-3 text-[13px] font-black text-[#66739A]">Cancelar</button>
                        <button type="button" onClick={() => void confirmNotSuitable()} disabled={notSuitableSaving} className="flex-1 rounded-[14px] bg-orange-500 py-3 text-[13px] font-black text-white disabled:opacity-60">
                            {notSuitableSaving ? "Guardando..." : "Confirmar"}
                        </button>
                    </div>
                </BottomSheet>
            ) : null}

            {/* TOAST */}
            {toast ? (
                <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[60] rounded-[16px] border border-[#E8E7FB] bg-white px-4 py-3 text-center text-[12px] font-black text-[#101936] shadow-[0_16px_42px_rgba(91,33,255,0.16)]">
                    {toast}
                </div>
            ) : null}
        </div>
    );
}

// ── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function LeadCard({
    lead,
    note,
    waSent,
    copied,
    priority,
    canUndo,
    onManage,
    onUndo,
    onWhatsApp,
    onMaps,
    onCopy,
    onNote,
    canChatWithProspects,
}: {
    lead: MetaLeadDoc;
    note?: string;
    waSent?: boolean;
    copied?: boolean;
    priority: number | null;
    canUndo: boolean;
    onManage: () => void;
    onUndo: () => void;
    onWhatsApp: () => void;
    onMaps: () => void;
    onCopy: () => void;
    onNote?: () => void;
    canChatWithProspects: boolean;
}) {
    const isPending = !lead.status || lead.status === "pending";
    const isVisited = lead.status === "visited";
    const isRejected = lead.status === "rejected";
    const needsData = lead.verificationStatus === "pending_review" && (!lead.location?.lat || !lead.location?.mapsUrl || !lead.name);
    const canChat = isPending && (Boolean(lead.takenFromIncompleteAt) || canChatWithProspects);
    const userSeenAt = Math.max(lead.userChatLastSeenMessageAt ?? 0, lead.userChatSeenAt ?? 0);
    const hasUnreadChat = canChat && Boolean((lead.lastInboundMessageAt ?? 0) > userSeenAt);
    const unreadChatCount = hasUnreadChat ? Math.max(1, lead.userUnreadMessageCount ?? 0) : 0;

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
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={lead.status} />
                        {needsData ? (
                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700">
                                Faltan datos
                            </span>
                        ) : null}
                    </div>
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

                {/* ── NOTE ── */}
                {note ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-[10px] border border-violet-100 bg-violet-50 px-2.5 py-1.5">
                        <NoteIcon />
                        <p className="text-[11px] font-semibold text-[#5B21FF]">{note}</p>
                    </div>
                ) : null}

                {/* ── ACTIONS ── */}
                <div className="mt-3 flex items-center gap-2 border-t border-[#F2F0FF] pt-2.5">
                    {/* Quick actions */}
                    <div className="flex gap-1.5">
                        <ActionBtn onClick={onWhatsApp} title={waSent ? "Enviado" : "WhatsApp"} tone={waSent ? "sent" : "green"}>
                            {waSent ? <WACheckIcon /> : <WAIcon />}
                        </ActionBtn>
                        <ActionBtn onClick={onMaps} title="Maps" tone="blue">
                            <MapsIcon />
                        </ActionBtn>
                        <div className="relative">
                            <ActionBtn onClick={onCopy} title={copied ? "Copiado" : "Copiar"} tone={copied ? "sent" : "violet"}>
                                {copied ? <CheckIcon /> : <CopyIcon />}
                            </ActionBtn>
                            {copied ? (
                                <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-full border border-emerald-200 bg-white px-2 py-1 text-[9px] font-black text-emerald-700 shadow-[0_8px_22px_rgba(16,185,129,0.16)]">
                                    Copiado
                                </span>
                            ) : null}
                        </div>
                        {onNote ? (
                            <ActionBtn onClick={onNote} title="Nota" tone="violet">
                                <NoteIcon />
                            </ActionBtn>
                        ) : null}
                    </div>

                    <div className="flex-1" />

                    {isPending ? (
                        <div className="flex gap-1.5">
                            {canChat ? (
                                <div className="relative">
                                    <Link
                                        href={`/user/chat/${lead.id}`}
                                        className="flex h-7 items-center rounded-[10px] border border-violet-200 bg-violet-50 px-2.5 text-[10px] font-black text-[#7C3AED] shadow-sm transition active:bg-violet-100"
                                    >
                                        Chatear
                                    </Link>
                                    {unreadChatCount > 0 ? (
                                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-white bg-[#EF4444] px-1 text-[9px] font-black leading-none text-white shadow-[0_4px_12px_rgba(239,68,68,0.28)]">
                                            {unreadChatCount > 9 ? "9+" : unreadChatCount}
                                        </span>
                                    ) : null}
                                </div>
                            ) : null}
                            <button
                                type="button"
                                onClick={onManage}
                                className="flex h-7 items-center rounded-[10px] border border-[#E8E7FB] bg-white px-2.5 text-[10px] font-black text-[#7C3AED] shadow-sm transition active:bg-[#f3f0ff]"
                            >
                                Gestionar
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

function ActionBtn({ onClick, title, tone, children }: { onClick: () => void; title: string; tone: "green" | "blue" | "violet" | "sent" | "orange" | "red"; children: React.ReactNode }) {
    const cls: Record<string, string> = {
        green: "border-emerald-200 bg-emerald-50 text-emerald-700",
        blue: "border-blue-200 bg-blue-50 text-blue-700",
        violet: "border-violet-200 bg-violet-50 text-violet-700",
        sent: "border-[#6D28D9] bg-[#7C3AED] text-white shadow-[0_8px_18px_rgba(124,58,237,0.28)]",
        orange: "border-orange-200 bg-orange-50 text-orange-600",
        red: "border-red-200 bg-red-50 text-red-600",
    };
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`flex h-8 w-8 items-center justify-center rounded-[11px] border transition active:opacity-70 ${cls[tone]}`}
        >
            {children}
        </button>
    );
}

function BottomSheet({ children, onClose, tall }: { children: React.ReactNode; onClose: () => void; tall?: boolean }) {
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prev; };
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex items-end xl:items-center xl:justify-center">
            <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className={[
                "relative w-full overscroll-y-contain overflow-y-auto rounded-t-[24px] bg-white px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4 shadow-2xl xl:max-w-md xl:rounded-[24px] xl:pb-6",
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

// ── RECOVERY CARD ────────────────────────────────────────────────────────────

function RecoveryCard({
    lead, note, waSent, copied,
    onTake, onReview, onNotSuitable, onWhatsApp, onMaps, onCopy,
}: {
    lead: MetaLeadDoc;
    note?: string;
    waSent: boolean;
    copied: boolean;
    onTake: () => void;
    onReview: () => void;
    onNotSuitable: () => void;
    onWhatsApp: () => void;
    onMaps: () => void;
    onCopy: () => void;
}) {
    const ddd = extractDDD(lead.phone);
    const hasLocation = !!lead.location?.lat || !!lead.location?.mapsUrl;

    const locationBadge = (() => {
        const realCity = lead.location?.adminCityLabel || lead.location?.cityLabel || lead.location?.displayLabel;
        const fallbackCity = lead.leadAcquisitionCityLabel;
        const city = realCity || fallbackCity || (ddd ? dddCity(ddd) : "");
        if (ddd && city) return `${ddd} · ${city}`;
        if (ddd) return ddd;
        return city;
    })();

    const activity = lead.lastInboundMessageAt ?? lead.updatedAt ?? lead.createdAt ?? null;
    const activityLabel = (() => {
        if (!activity) return "";
        const diff = Date.now() - activity;
        const mins = Math.floor(diff / 60_000);
        if (mins < 1) return "Ahora";
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        return `${Math.floor(hrs / 24)}d`;
    })();

    return (
        <div className="overflow-hidden rounded-[18px] border border-[#E8E7FB] bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]">
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-black text-[#101936]">
                            {lead.business || lead.name || lead.phone || "Sin nombre"}
                        </p>
                        {lead.name && lead.business ? (
                            <p className="truncate text-[11px] font-semibold text-[#66739A]">{lead.name}</p>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        {locationBadge ? (
                            <span className="rounded-full bg-[#f3f0ff] px-2 py-0.5 text-[9px] font-black text-[#7C3AED]">
                                {locationBadge}
                            </span>
                        ) : null}
                        {activityLabel ? (
                            <span className="text-[10px] font-semibold text-[#98A2B3]">{activityLabel}</span>
                        ) : null}
                    </div>
                </div>

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

                {(!hasLocation || !lead.business) ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {!hasLocation ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Falta: ubicación
                            </span>
                        ) : null}
                        {!lead.business ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />Falta: negocio
                            </span>
                        ) : null}
                    </div>
                ) : null}

                {lead.lastInboundText ? (
                    <p className="mt-2 line-clamp-2 rounded-[10px] border border-[#F2F0FF] bg-[#f8f7ff] px-2.5 py-1.5 text-[11px] font-semibold text-[#66739A]">
                        {lead.lastInboundText}
                    </p>
                ) : null}

                {note ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-[10px] border border-violet-100 bg-violet-50 px-2.5 py-1.5">
                        <NoteIcon />
                        <p className="text-[11px] font-semibold text-[#5B21FF]">{note}</p>
                    </div>
                ) : null}

                <div className="mt-3 flex items-center gap-1.5 border-t border-[#F2F0FF] pt-2.5">
                    <ActionBtn onClick={onReview} tone="violet" title="Ver chat"><ChatIcon /></ActionBtn>
                    <button
                        type="button"
                        onClick={onTake}
                        className="flex h-8 flex-1 items-center justify-center rounded-[11px] border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-black text-emerald-700 transition active:bg-emerald-100"
                    >
                        Verificar
                    </button>
                    <ActionBtn onClick={onNotSuitable} tone="orange" title="No Apto"><BanIcon /></ActionBtn>
                    <div className="relative">
                        <ActionBtn onClick={onCopy} title={copied ? "Copiado" : "Copiar"} tone={copied ? "sent" : "violet"}>
                            {copied ? <CheckIcon /> : <CopyIcon />}
                        </ActionBtn>
                        {copied ? (
                            <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-full border border-emerald-200 bg-white px-2 py-1 text-[9px] font-black text-emerald-700 shadow-[0_8px_22px_rgba(16,185,129,0.16)]">
                                Copiado
                            </span>
                        ) : null}
                    </div>
                    <ActionBtn onClick={onWhatsApp} tone={waSent ? "sent" : "green"} title={waSent ? "Enviado" : "WhatsApp"}>
                        {waSent ? <WACheckIcon /> : <WAIcon />}
                    </ActionBtn>
                    {hasLocation ? (
                        <ActionBtn onClick={onMaps} title="Maps" tone="blue"><MapsIcon /></ActionBtn>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

// ── CAMPAIGN LEAD CARD ───────────────────────────────────────────────────────

function CampaignLeadCard({
    lead, note, waSent, copied, managing,
    onVisit, onReject, onReview, onNotSuitable, onWhatsApp, onMaps, onCopy, onNote,
}: {
    lead: MetaLeadDoc;
    note?: string;
    waSent: boolean;
    copied: boolean;
    managing: boolean;
    onVisit: () => void;
    onReject: () => void;
    onReview: () => void;
    onNotSuitable: () => void;
    onWhatsApp: () => void;
    onMaps?: () => void;
    onCopy: () => void;
    onNote: () => void;
}) {
    const hasLocation = !!lead.location?.lat || !!lead.location?.mapsUrl;

    return (
        <div className="overflow-hidden rounded-[18px] border border-amber-100 bg-white shadow-[0_2px_12px_rgba(91,33,255,0.05)]">
            <div className="p-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="truncate text-[14px] font-black text-[#101936]">
                            {lead.business || lead.name || lead.phone || "Sin nombre"}
                        </p>
                        {lead.name && lead.business ? (
                            <p className="truncate text-[11px] font-semibold text-[#66739A]">{lead.name}</p>
                        ) : null}
                    </div>
                    <span className="shrink-0 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Sin verificar</span>
                </div>

                {/* Details */}
                <div className="mt-1.5 space-y-1">
                    {lead.phone ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PhoneIcon /> <span className="truncate">{lead.phone}</span>
                        </div>
                    ) : null}
                    {lead.location?.address ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PinIcon /> <span className="truncate">{lead.location.address}</span>
                        </div>
                    ) : lead.leadAcquisitionCityLabel ? (
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#66739A]">
                            <PinIcon /> <span className="truncate">{lead.leadAcquisitionCityLabel}</span>
                        </div>
                    ) : null}
                </div>

                {/* Missing data badges */}
                {(!hasLocation || !lead.business) ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {!hasLocation ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Falta: ubicación
                            </span>
                        ) : null}
                        {!lead.business ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />Falta: negocio
                            </span>
                        ) : null}
                    </div>
                ) : null}

                {/* Last message snippet */}
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

                {/* Actions */}
                <div className="mt-3 flex items-center gap-1.5 border-t border-[#F2F0FF] pt-2.5">
                    <ActionBtn onClick={onReview} tone="violet" title="Ver chat"><ChatIcon /></ActionBtn>
                    <ActionBtn onClick={onWhatsApp} tone={waSent ? "sent" : "green"} title={waSent ? "Enviado" : "WhatsApp"}>
                        {waSent ? <WACheckIcon /> : <WAIcon />}
                    </ActionBtn>
                    {onMaps ? <ActionBtn onClick={onMaps} title="Maps" tone="blue"><MapsIcon /></ActionBtn> : null}
                    <div className="relative">
                        <ActionBtn onClick={onCopy} title={copied ? "Copiado" : "Copiar"} tone={copied ? "sent" : "violet"}>
                            {copied ? <CheckIcon /> : <CopyIcon />}
                        </ActionBtn>
                        {copied ? (
                            <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-full border border-emerald-200 bg-white px-2 py-1 text-[9px] font-black text-emerald-700 shadow-[0_8px_22px_rgba(16,185,129,0.16)]">
                                Copiado
                            </span>
                        ) : null}
                    </div>
                    <ActionBtn onClick={onNote} title="Nota" tone="violet"><NoteIcon /></ActionBtn>
                    <ActionBtn onClick={onNotSuitable} tone="orange" title="No Apto"><BanIcon /></ActionBtn>
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={onVisit}
                        disabled={managing}
                        className="flex h-7 items-center gap-1.5 rounded-[10px] border border-emerald-200 bg-emerald-50 px-2.5 text-[10px] font-black text-emerald-700 shadow-sm transition active:bg-emerald-100 disabled:opacity-50"
                    >
                        {managing ? (
                            <svg className="tg-spin h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3.1-6.8" /></svg>
                        ) : <CheckIcon />}
                        Visitar
                    </button>
                    <button
                        type="button"
                        onClick={onReject}
                        disabled={managing}
                        className="flex h-7 items-center gap-1.5 rounded-[10px] border border-red-200 bg-red-50 px-2.5 text-[10px] font-black text-red-600 shadow-sm transition active:bg-red-100 disabled:opacity-50"
                    >
                        <XIcon />
                        Rechazar
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── FILTER CHIPS ─────────────────────────────────────────────────────────────

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} className={["flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black transition", active ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-[#E8E7FB] bg-white text-[#66739A]"].join(" ")}>
            {children}
        </button>
    );
}
function CountPill({ active, children }: { active: boolean; children: React.ReactNode }) {
    return (
        <span className={["flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black", active ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]"].join(" ")}>{children}</span>
    );
}

// ── ICONS ────────────────────────────────────────────────────────────────────

function HeaderSubscriptionBadge({ status }: { status: VendorSubscriptionStatus }) {
    const active = status === "active";
    const loading = status === "loading";
    return (
        <span className={[
            "inline-flex h-10 items-center gap-1.5 rounded-[13px] border px-2.5 text-[9px] font-black uppercase tracking-[0.06em] shadow-sm sm:text-[10px] sm:tracking-[0.08em]",
            active
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : loading
                  ? "border-slate-100 bg-white text-slate-400"
                  : "border-rose-100 bg-rose-50 text-rose-600",
        ].join(" ")}>
            <span className={[
                "h-1.5 w-1.5 rounded-full",
                active ? "bg-emerald-500" : loading ? "bg-slate-300" : "bg-rose-400",
                active ? "animate-pulse" : "",
            ].join(" ")} />
            <span className="sm:hidden">{active ? "Activa" : loading ? "..." : "Inactiva"}</span>
            <span className="hidden sm:inline">{active ? "Suscripcion activa" : loading ? "Suscripcion" : "Suscripcion inactiva"}</span>
        </span>
    );
}

const ic = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };

function SearchIcon() {
    return <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#7C3AED]" {...ic}><path d="m21 21-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" /></svg>;
}
function FilterIcon() {
    return <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[#7C3AED]" {...ic}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
}
function ChevronDownIcon() {
    return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-[#98A2B3]" {...ic}><path d="m6 9 6 6 6-6" /></svg>;
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
function CopyIcon() {
    return <svg viewBox="0 0 24 24" className="h-4 w-4" {...ic}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
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
function NoteIcon() {
    return <svg viewBox="0 0 24 24" className="mt-0.5 h-3 w-3 shrink-0 text-[#7C3AED]" {...ic} strokeWidth={2}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>;
}
function WACheckIcon() {
    return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z"/><path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z"/><path d="m14.5 9-4.5 4.5-2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function InboxIcon() {
    return <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#7C3AED]" {...ic}><path d="M4 4h16l-2 9H6L4 4Z" /><path d="M6 13v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" /></svg>;
}
function ChatIcon() {
    return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></svg>;
}
function BanIcon() {
    return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...ic}><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>;
}

// ── MESSAGE BUBBLE (for read-only chat in No verificados) ─────────────────────

function formatMessageTime(ts: number | null | undefined): string {
    if (!ts) return "";
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function IncMessageBubble({ message }: { message: LeadMessageDoc }) {
    const outbound = message.direction === "outbound";
    const sender = message.senderType === "bot" ? "Bot" : message.senderType === "admin" ? "Admin" : "Cliente";
    return (
        <div className={["flex", outbound ? "justify-end" : "justify-start"].join(" ")}>
            <div className={[
                "max-w-[82%] rounded-[15px] px-3 py-2",
                outbound ? "rounded-br-[4px] bg-[#7C3AED] text-white" : "rounded-bl-[4px] border border-[#E8E7FB] bg-white text-[#101936]",
            ].join(" ")}>
                <p className={["mb-0.5 text-[9px] font-black uppercase tracking-wide", outbound ? "text-violet-200" : "text-[#98A2B3]"].join(" ")}>{sender}</p>
                <p className="whitespace-pre-wrap text-[12px] font-semibold leading-relaxed">{message.text}</p>
                <p className={["mt-1 text-right text-[9px] font-semibold", outbound ? "text-violet-200" : "text-[#98A2B3]"].join(" ")}>{formatMessageTime(message.createdAt)}</p>
            </div>
        </div>
    );
}
