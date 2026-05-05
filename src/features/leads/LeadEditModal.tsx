"use client";

import { useEffect, useMemo, useState } from "react";
import { updateLeadDetails } from "@/data/leadsRepo";
import type { LeadDetailsPatch, LeadParseStatus, MetaLeadDoc } from "@/types/leads";
import type { UserDoc } from "@/types/users";
import { Button, Field, Input, Modal } from "@/components/ui";

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function cleanPhone(value: string) {
    return value.replace(/\D+/g, "");
}

function extractLatLngFromMapsUrl(url: string): { lat: number | null; lng: number | null } {
    const raw = url.trim();
    if (!raw) return { lat: null, lng: null };

    try {
        const decoded = decodeURIComponent(raw);
        const patterns = [
            /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
            /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
        ];

        for (const pattern of patterns) {
            const match = decoded.match(pattern);
            const lat = Number(match?.[1]);
            const lng = Number(match?.[2]);

            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                return {
                    lat: Math.round(lat * 1000000) / 1000000,
                    lng: Math.round(lng * 1000000) / 1000000,
                };
            }
        }
    } catch {
        return { lat: null, lng: null };
    }

    return { lat: null, lng: null };
}

function nextParseStatus({
    business,
    mapsUrl,
}: {
    business: string;
    mapsUrl: string;
}): LeadParseStatus {
    if (business.trim() && mapsUrl.trim()) return "ready";
    if (business.trim() || mapsUrl.trim()) return "partial";
    return "empty";
}

export function LeadEditModal({
    lead,
    open,
    onClose,
    onSaved,
    users = [],
    onAssign,
}: {
    lead: MetaLeadDoc | null;
    open: boolean;
    onClose: () => void;
    onSaved?: () => void;
    users?: UserDoc[];
    onAssign?: (lead: MetaLeadDoc, userId: string) => Promise<void>;
}) {
    const [name, setName] = useState("");
    const [business, setBusiness] = useState("");
    const [businessRaw, setBusinessRaw] = useState("");
    const [phone, setPhone] = useState("");
    const [mapsUrl, setMapsUrl] = useState("");
    const [address, setAddress] = useState("");
    const [assignedUserId, setAssignedUserId] = useState("");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!lead) return;

        queueMicrotask(() => {
            setName(lead.name ?? "");
            setBusiness(lead.business ?? "");
            setBusinessRaw(text(lead.raw.businessRaw));
            setPhone(lead.phone ?? "");
            setMapsUrl(lead.location.mapsUrl ?? "");
            setAddress(lead.location.address ?? "");
            setAssignedUserId(lead.assignedTo ?? "");
            setErr(null);
        });
    }, [lead]);

    const mapsPreview = useMemo(() => extractLatLngFromMapsUrl(mapsUrl), [mapsUrl]);

    if (!lead) return null;

    async function save() {
        if (!lead) return;
        const activeLead = lead;
        const cleanPhoneValue = cleanPhone(phone);
        const cleanBusiness = business.trim();
        const cleanMapsUrl = mapsUrl.trim();

        if (!cleanPhoneValue) {
            setErr("El telefono es obligatorio.");
            return;
        }

        setSaving(true);
        setErr(null);

        const patch: LeadDetailsPatch = {
            name: name.trim(),
            business: cleanBusiness,
            businessRaw: businessRaw.trim(),
            phone: cleanPhoneValue,
            waId: cleanPhoneValue,
            mapsUrl: cleanMapsUrl,
            address: address.trim(),
            lat: mapsPreview.lat,
            lng: mapsPreview.lng,
            currentLeadMapsConfirmedAt: cleanMapsUrl ? Date.now() : null,
            parseStatus: nextParseStatus({ business: cleanBusiness, mapsUrl: cleanMapsUrl }),
        };

        try {
            await updateLeadDetails(activeLead.id, patch);

            if (assignedUserId && assignedUserId !== activeLead.assignedTo) {
                if (!onAssign) {
                    throw new Error("No hay una accion de asignacion configurada.");
                }

                await onAssign(activeLead, assignedUserId);
            }

            onSaved?.();
            onClose();
        } catch (error) {
            setErr(error instanceof Error ? error.message : "No se pudo guardar el lead.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Editar lead"
            subtitle={lead.phone || lead.id}
        >
            <div className="space-y-4">
                {err ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-600">
                        {err}
                    </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nombre">
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </Field>

                    <Field label="Telefono">
                        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Negocio">
                        <Input value={business} onChange={(e) => setBusiness(e.target.value)} />
                    </Field>

                    <Field label="Negocio original">
                        <Input value={businessRaw} onChange={(e) => setBusinessRaw(e.target.value)} />
                    </Field>
                </div>

                <Field label="Google Maps">
                    <Input
                        value={mapsUrl}
                        onChange={(e) => setMapsUrl(e.target.value)}
                        placeholder="https://maps.google.com/..."
                    />
                </Field>

                <Field label="Direccion">
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                </Field>

                <Field label="Asignar usuario">
                    <select
                        value={assignedUserId}
                        onChange={(e) => setAssignedUserId(e.target.value)}
                        disabled={!users.length}
                        className="h-9 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 text-[12px] font-semibold text-[#52525b] outline-none disabled:bg-[#f7f7f8] disabled:text-[#9ca3af]"
                    >
                        <option value="">Sin asignar</option>
                        {users.map((user) => (
                            <option key={user.id} value={user.id}>
                                {user.name || user.email || "Usuario sin nombre"}
                            </option>
                        ))}
                    </select>
                </Field>

                <Field label="Coordenadas">
                    <Input
                        value={
                            mapsPreview.lat != null && mapsPreview.lng != null
                                ? `${mapsPreview.lat}, ${mapsPreview.lng}`
                                : ""
                        }
                        readOnly
                        placeholder="Sin coordenadas detectadas"
                    />
                </Field>

                <div className="flex justify-end gap-2 border-t border-[#f0f1f2] pt-4">
                    <Button onClick={onClose} disabled={saving}>Cancelar</Button>
                    <Button variant="primary" onClick={save} disabled={saving}>
                        {saving ? "Guardando..." : "Guardar cambios"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
