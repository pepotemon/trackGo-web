"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APIProvider, AdvancedMarker, Map, useMap } from "@vis.gl/react-google-maps";
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

type MapFilter = "all" | "pending" | "visited" | "rejected";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined;

function todayKey() { return new Date().toISOString().slice(0, 10); }

function displayName(lead: MetaLeadDoc) {
    return lead.name || lead.business || lead.phone || "Sin nombre";
}

const REJECTION_REASONS = Object.entries(REJECTED_REASON_LABELS) as [RejectedReason, string][];

export default function UserMapPage() {
    return (
        <APIProvider apiKey={API_KEY}>
            <MapPageInner />
        </APIProvider>
    );
}

function MapPageInner() {
    const { firebaseUser } = useAuth();
    const userId = firebaseUser?.uid ?? "";

    const [leads, setLeads] = useState<MetaLeadDoc[]>([]);
    const [loadingLeads, setLoadingLeads] = useState(true);
    const [mapFilter, setMapFilter] = useState<MapFilter>("pending");
    const [selectedLead, setSelectedLead] = useState<MetaLeadDoc | null>(null);
    const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [locating, setLocating] = useState(false);

    const [actionType, setActionType] = useState<"visit" | "reject" | null>(null);
    const [rejectStep, setRejectStep] = useState<1 | 2>(1);
    const [rejectReason, setRejectReason] = useState<RejectedReason | null>(null);
    const [rejectText, setRejectText] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!userId) return;
        setLoadingLeads(true);
        const unsub = subscribeUserLeads(userId, (data) => {
            setLeads(data);
            setLoadingLeads(false);
        });
        return unsub;
    }, [userId]);

    const leadsWithCoords = useMemo(() =>
        leads.filter((l) => l.location.lat !== null && l.location.lng !== null),
        [leads]
    );

    const filteredLeads = useMemo(() => {
        if (mapFilter === "all") return leadsWithCoords;
        return leadsWithCoords.filter((l) => {
            if (mapFilter === "pending") return !l.status || l.status === "pending";
            return l.status === mapFilter;
        });
    }, [leadsWithCoords, mapFilter]);

    const counts = useMemo(() => ({
        all: leadsWithCoords.length,
        pending: leadsWithCoords.filter((l) => !l.status || l.status === "pending").length,
        visited: leadsWithCoords.filter((l) => l.status === "visited").length,
        rejected: leadsWithCoords.filter((l) => l.status === "rejected").length,
    }), [leadsWithCoords]);

    function locate() {
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                setLocating(false);
            },
            () => { setLocating(false); },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    }

    // Auto-locate on mount
    useEffect(() => { locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const today = todayKey();

    function canUndo(lead: MetaLeadDoc) {
        if (lead.status !== "visited" && lead.status !== "rejected") return false;
        const statusAt = (lead as any).statusAt as number | null;
        if (!statusAt) return true;
        return new Date(statusAt).toISOString().slice(0, 10) === today;
    }

    function openVisit() { setActionType("visit"); }
    function openReject() {
        setActionType("reject");
        setRejectStep(1);
        setRejectReason(null);
        setRejectText("");
    }
    function closeAction() { setActionType(null); setSaving(false); }

    async function confirmVisit() {
        if (!selectedLead || !userId) return;
        setSaving(true);
        try {
            await markLeadVisited(selectedLead, userId);
            closeAction();
        } catch { setSaving(false); }
    }

    function selectReason(r: RejectedReason) {
        setRejectReason(r);
        if (r !== "otro") setRejectStep(2);
    }

    async function confirmReject() {
        if (!selectedLead || !rejectReason || !userId) return;
        setSaving(true);
        try {
            await markLeadRejected(selectedLead, userId, rejectReason, rejectText);
            closeAction();
        } catch { setSaving(false); }
    }

    async function handleUndo() {
        if (!selectedLead || !userId) return;
        await resetLeadPending(selectedLead, userId);
    }

    function openWhatsApp(lead: MetaLeadDoc) {
        const phone = lead.phone.replace(/\D/g, "");
        const br = phone.startsWith("55") ? phone : `55${phone}`;
        const msg = encodeURIComponent(`Olá, ${lead.name || "tudo bem"}! Estou entrando em contato sobre seu interesse.`);
        window.open(`https://wa.me/${br}?text=${msg}`, "_blank");
    }

    function openMaps(lead: MetaLeadDoc) {
        const url = lead.location.mapsUrl || `https://maps.google.com/?q=${lead.location.lat},${lead.location.lng}`;
        window.open(url, "_blank");
    }

    const defaultCenter = leadsWithCoords.length > 0
        ? { lat: leadsWithCoords[0].location.lat!, lng: leadsWithCoords[0].location.lng! }
        : { lat: -23.55, lng: -46.63 };

    return (
        <div className="relative h-[calc(100dvh-72px)] overscroll-none xl:h-screen">
            <Map
                defaultCenter={defaultCenter}
                defaultZoom={12}
                mapId={MAP_ID}
                mapTypeId="roadmap"
                disableDefaultUI
                gestureHandling="greedy"
                style={{ width: "100%", height: "100%" }}
                onClick={() => setSelectedLead(null)}
            >
                    {filteredLeads.map((lead) => (
                        <AdvancedMarker
                            key={lead.id}
                            position={{ lat: lead.location.lat!, lng: lead.location.lng! }}
                            onClick={() => setSelectedLead(lead)}
                        >
                            <PinImage
                                status={lead.status}
                                selected={selectedLead?.id === lead.id}
                            />
                        </AdvancedMarker>
                    ))}

                    {userLocation ? (
                        <AdvancedMarker position={userLocation}>
                            <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-blue-500 shadow-lg">
                                <div className="h-2 w-2 rounded-full bg-white" />
                            </div>
                        </AdvancedMarker>
                    ) : null}

                    <MapControls
                        leads={filteredLeads}
                        onLocate={locate}
                        locating={locating}
                        userLocation={userLocation}
                    />
            </Map>

            {/* ── FILTER DOCK ─────────────────────────────────────────── */}
            <div className="absolute right-3 top-4 z-10 flex flex-col gap-1.5">
                {(["all", "pending", "visited", "rejected"] as MapFilter[]).map((f) => {
                    const labels: Record<MapFilter, string> = { all: "Todos", pending: "Pend.", visited: "Visit.", rejected: "Rech." };
                    const dots: Record<MapFilter, string> = { all: "#7C3AED", pending: "#F59E0B", visited: "#059669", rejected: "#DC2626" };
                    const active = mapFilter === f;
                    return (
                        <button
                            key={f}
                            type="button"
                            onClick={() => setMapFilter(f)}
                            className={[
                                "flex items-center gap-1.5 rounded-[12px] border px-3 py-2 text-[11px] font-black shadow-lg backdrop-blur-md transition",
                                active
                                    ? "border-[#7C3AED] bg-[#7C3AED] text-white"
                                    : "border-white/60 bg-white/90 text-[#344054] hover:border-[#7C3AED]/40",
                            ].join(" ")}
                        >
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: active ? "rgba(255,255,255,0.7)" : dots[f] }}
                            />
                            {labels[f]}
                            <span className={[
                                "ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black",
                                active ? "bg-white/25 text-white" : "bg-[#f3f0ff] text-[#7C3AED]",
                            ].join(" ")}>
                                {counts[f]}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* ── LOADING OVERLAY ─────────────────────────────────────── */}
            {loadingLeads ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 shadow-xl">
                        <svg className="tg-spin h-8 w-8 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                        </svg>
                        <p className="text-[13px] font-bold text-[#66739A]">Cargando prospectos...</p>
                    </div>
                </div>
            ) : null}

            {/* ── SELECTED LEAD CARD ──────────────────────────────────── */}
            {selectedLead ? (
                <div className="absolute bottom-0 left-0 right-0 z-10 px-3 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
                    <div className="overflow-hidden rounded-[20px] border border-[#E8E7FB] bg-white shadow-[0_-8px_40px_rgba(91,33,255,0.18)]">
                        {/* Drag handle */}
                        <div className="flex justify-center pt-2 pb-1">
                            <div className="h-1 w-10 rounded-full bg-[#E8E7FB]" />
                        </div>

                        <div className="px-4 pb-4">
                            {/* Header */}
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="min-w-0">
                                    <p className="truncate text-[16px] font-black text-[#101936]">
                                        {displayName(selectedLead)}
                                    </p>
                                    {selectedLead.business && selectedLead.name ? (
                                        <p className="truncate text-[11px] font-semibold text-[#66739A]">{selectedLead.business}</p>
                                    ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                    <LeadStatusBadge status={selectedLead.status} />
                                    <button
                                        type="button"
                                        onClick={() => setSelectedLead(null)}
                                        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3f0ff] text-[#7C3AED]"
                                        aria-label="Cerrar"
                                    >
                                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            </div>

                            {/* Address */}
                            {selectedLead.location.address ? (
                                <div className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#66739A]">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-[#7C3AED]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth={1.8} />
                                    </svg>
                                    <span className="line-clamp-2">{selectedLead.location.address}</span>
                                </div>
                            ) : null}

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                                {/* Quick links */}
                                <button
                                    type="button"
                                    onClick={() => openWhatsApp(selectedLead)}
                                    className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-emerald-200 bg-emerald-50 text-emerald-700 transition active:bg-emerald-100"
                                    title="WhatsApp"
                                >
                                    <WAIcon />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openMaps(selectedLead)}
                                    className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-blue-200 bg-blue-50 text-blue-700 transition active:bg-blue-100"
                                    title="Maps"
                                >
                                    <MapsIcon />
                                </button>

                                <div className="flex-1" />

                                {/* Status actions */}
                                {(!selectedLead.status || selectedLead.status === "pending") ? (
                                    <div className="flex gap-1.5">
                                        <button
                                            type="button"
                                            onClick={openReject}
                                            className="flex h-9 items-center gap-1.5 rounded-[12px] border border-red-200 bg-red-50 px-3 text-[12px] font-black text-red-600 transition active:bg-red-100"
                                        >
                                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                                            Rechazar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={openVisit}
                                            className="flex h-9 items-center gap-1.5 rounded-[12px] border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-black text-emerald-700 transition active:bg-emerald-100"
                                        >
                                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                                            Visité
                                        </button>
                                    </div>
                                ) : canUndo(selectedLead) ? (
                                    <button
                                        type="button"
                                        onClick={handleUndo}
                                        className="flex h-9 items-center gap-1.5 rounded-[12px] border border-[#E8E7FB] bg-white px-3 text-[12px] font-black text-[#66739A] transition active:bg-[#f3f0ff]"
                                    >
                                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M3 7v6h6" /><path d="M3 13a9 9 0 1 0 2.6-6.36L3 10" /></svg>
                                        Deshacer
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* ── VISIT MODAL ─────────────────────────────────────────── */}
            {actionType === "visit" && selectedLead ? (
                <BottomSheet onClose={closeAction}>
                    <div className="mb-4">
                        <div className="mb-1">
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">VISITA</span>
                        </div>
                        <p className="text-[17px] font-black text-[#101936]">{displayName(selectedLead)}</p>
                        {selectedLead.location.address ? (
                            <p className="mt-0.5 text-[12px] font-semibold text-[#66739A]">{selectedLead.location.address}</p>
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
            {actionType === "reject" && selectedLead ? (
                <BottomSheet onClose={closeAction} tall>
                    <div className="mb-4">
                        <div className="mb-1">
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black text-red-700">RECHAZO</span>
                        </div>
                        <p className="text-[17px] font-black text-[#101936]">{displayName(selectedLead)}</p>
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
        </div>
    );
}

// ── MAP CONTROLS (needs useMap hook, must be inside APIProvider+Map) ─────────

function MapControls({
    leads,
    onLocate,
    locating,
    userLocation,
}: {
    leads: MetaLeadDoc[];
    onLocate: () => void;
    locating: boolean;
    userLocation: { lat: number; lng: number } | null;
}) {
    const map = useMap();
    const centeredRef = useRef(false);

    // Auto-center on user location the first time it arrives
    useEffect(() => {
        if (!map || !userLocation || centeredRef.current) return;
        centeredRef.current = true;
        map.panTo(userLocation);
        map.setZoom(15);
    }, [map, userLocation]);

    const fitBounds = useCallback(() => {
        if (!map || leads.length === 0) return;
        const bounds = new google.maps.LatLngBounds();
        leads.forEach((l) => {
            if (l.location.lat !== null && l.location.lng !== null) {
                bounds.extend({ lat: l.location.lat!, lng: l.location.lng! });
            }
        });
        map.fitBounds(bounds, { top: 60, bottom: 220, left: 16, right: 80 });
    }, [map, leads]);

    const goToUser = useCallback(() => {
        if (!map) return;
        onLocate();
        if (userLocation) {
            map.panTo(userLocation);
            map.setZoom(15);
        }
    }, [map, onLocate, userLocation]);

    const zoomIn = useCallback(() => {
        if (!map) return;
        map.setZoom((map.getZoom() ?? 12) + 1);
    }, [map]);

    const zoomOut = useCallback(() => {
        if (!map) return;
        map.setZoom((map.getZoom() ?? 12) - 1);
    }, [map]);

    return (
        <>
            {/* Fit + locate — both platforms */}
            <div className="absolute bottom-[200px] left-3 z-10 flex flex-col gap-2">
                <MapCtrlBtn onClick={fitBounds} title="Ver todos">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                    </svg>
                </MapCtrlBtn>
                <MapCtrlBtn onClick={goToUser} title="Mi ubicación" loading={locating}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7Z" /><circle cx="12" cy="9" r="2.5" />
                    </svg>
                </MapCtrlBtn>
            </div>

            {/* Zoom controls — desktop only */}
            <div className="absolute bottom-[200px] right-3 z-10 hidden flex-col gap-1 xl:flex">
                <MapCtrlBtn onClick={zoomIn} title="Acercar">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                </MapCtrlBtn>
                <MapCtrlBtn onClick={zoomOut} title="Alejar">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                        <path d="M5 12h14" />
                    </svg>
                </MapCtrlBtn>
            </div>
        </>
    );
}

function MapCtrlBtn({ onClick, title, loading, children }: { onClick: () => void; title: string; loading?: boolean; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            disabled={loading}
            className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-white/60 bg-white/90 text-[#344054] shadow-lg backdrop-blur-md transition hover:bg-white active:bg-[#f3f0ff] disabled:opacity-60"
        >
            {loading ? (
                <svg className="tg-spin h-4 w-4 text-[#7C3AED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-3.1-6.8" />
                </svg>
            ) : children}
        </button>
    );
}

// ── PIN IMAGE ────────────────────────────────────────────────────────────────

function PinImage({ status, selected }: { status?: string; selected: boolean }) {
    const base = status === "visited"
        ? "/pins/visited-pin"
        : status === "rejected"
        ? "/pins/rejected-pin"
        : "/pins/pending-pin";

    return (
        <div className={["transition-transform", selected ? "scale-150" : "scale-100"].join(" ")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={`${base}.png`}
                srcSet={`${base}.png 1x, ${base}@2x.png 2x, ${base}@3x.png 3x`}
                width={16}
                height={16}
                alt={status ?? "pending"}
                className="drop-shadow-md"
                style={{ imageRendering: "crisp-edges" }}
            />
        </div>
    );
}

// ── LEAD STATUS BADGE ────────────────────────────────────────────────────────

function LeadStatusBadge({ status }: { status?: string }) {
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

// ── BOTTOM SHEET ─────────────────────────────────────────────────────────────

function BottomSheet({ children, onClose, tall }: { children: React.ReactNode; onClose: () => void; tall?: boolean }) {
    return (
        <div className="absolute inset-0 z-50 flex items-end">
            <button type="button" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
            <div className={[
                "relative w-full overflow-y-auto rounded-t-[24px] bg-white px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4 shadow-2xl",
                tall ? "max-h-[85vh]" : "max-h-[70vh]",
            ].join(" ")}>
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#E8E7FB]" />
                {children}
            </div>
        </div>
    );
}

// ── ICONS ────────────────────────────────────────────────────────────────────

function WAIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M17.47 14.38c-.28-.14-1.65-.82-1.9-.91-.26-.09-.44-.14-.63.14-.19.28-.73.91-.9 1.1-.16.18-.33.2-.61.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.55-.46-.47-.63-.48-.16-.01-.35-.01-.53-.01-.18 0-.48.07-.73.34-.25.27-.97.95-.97 2.31 0 1.36.99 2.67 1.13 2.86.14.18 1.96 2.99 4.75 4.2.66.28 1.18.45 1.58.58.66.21 1.27.18 1.74.11.53-.08 1.65-.68 1.88-1.33.24-.65.24-1.2.17-1.33-.07-.12-.25-.19-.53-.33Z" />
            <path d="M12.05 2.01C6.49 2.01 2 6.5 2 12.07c0 1.87.51 3.63 1.4 5.14L2 22l4.93-1.36A10.04 10.04 0 0 0 12.05 22C17.61 22 22 17.5 22 11.93 22 6.5 17.61 2.01 12.05 2.01Zm0 18.37a8.34 8.34 0 0 1-4.23-1.15l-.3-.18-3.13.86.86-3.17-.2-.32a8.35 8.35 0 0 1-1.27-4.41c0-4.61 3.72-8.36 8.3-8.36 4.57 0 8.29 3.75 8.29 8.36-.01 4.61-3.72 8.37-8.32 8.37Z" />
        </svg>
    );
}

function MapsIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
            <path d="M9 3v15M15 6v15" />
        </svg>
    );
}
