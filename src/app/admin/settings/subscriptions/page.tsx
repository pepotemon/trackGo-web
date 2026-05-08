"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePermissions } from "@/features/auth/usePermissions";
import type { SubscriptionCity } from "@/types/subscriptions";

type CityFormState = {
    id: string;
    name: string;
    state: string;
    country: string;
    status: "available" | "reserved" | "occupied";
    campaignId: string;
};

type SubscriptionSettings = {
    adsShare: number;
    cycleDays: number;
    updatedAt?: number | null;
};

type OverviewSubscription = {
    id: string;
    userName: string;
    userEmail?: string;
    cityId?: string | null;
    city?: string | null;
    plan?: string | null;
    amount: number;
    adsBudget: number;
    status: string;
    campaignId?: string | null;
    startDate?: number | null;
    endDate?: number | null;
};

type OverviewCheckout = {
    id: string;
    cityId?: string | null;
    userName: string;
    cityName?: string | null;
    amount: number;
    adsBudget: number;
    status: string;
    activationStatus: string;
    failureReason?: string | null;
    paymentId?: string;
    updatedAt?: number | null;
};

type Overview = {
    settings: SubscriptionSettings;
    cities: SubscriptionCity[];
    subscriptions: OverviewSubscription[];
    checkouts: OverviewCheckout[];
};

const emptyCityForm: CityFormState = {
    id: "",
    name: "",
    state: "",
    country: "Brasil",
    status: "available",
    campaignId: "",
};

const currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
});
const inputClass = "h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold text-[#101936] outline-none disabled:bg-[#f8f7ff] disabled:text-[#98a2b3]";

const dateTime = new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
});

export default function SubscriptionsAdminPage() {
    const permissions = usePermissions();
    const { isSuperAdmin } = useAuth();
    const [overview, setOverview] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [cityModalOpen, setCityModalOpen] = useState(false);
    const [editingCityId, setEditingCityId] = useState<string | null>(null);
    const [cityForm, setCityForm] = useState<CityFormState>(emptyCityForm);
    const [citySaving, setCitySaving] = useState(false);
    const [citySaveError, setCitySaveError] = useState("");
    const [campaignValidation, setCampaignValidation] = useState({ loading: false, ok: false, message: "" });
    const [settingsDraft, setSettingsDraft] = useState<SubscriptionSettings>({ adsShare: 0.5, cycleDays: 5 });
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsError, setSettingsError] = useState("");
    const [actionMessage, setActionMessage] = useState("");
    const [actionBusyId, setActionBusyId] = useState("");

    const canView = permissions.subscriptionsView || permissions.subscriptionsEdit;
    const canManageCities = permissions.subscriptionsEdit || isSuperAdmin;

    const loadOverview = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/overview", {
                cache: "no-store",
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo cargar suscripciones.");
            const next: Overview = {
                settings: data.settings,
                cities: data.cities || [],
                subscriptions: data.subscriptions || [],
                checkouts: data.checkouts || [],
            };
            setOverview(next);
            setSettingsDraft(next.settings);
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo cargar suscripciones.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    const activeSubscriptions = useMemo(
        () => overview?.subscriptions.filter((item) => item.status === "active" || item.status === "expiring") ?? [],
        [overview],
    );
    const cityStats = useMemo(() => {
        const cities = overview?.cities ?? [];
        return {
            total: cities.length,
            available: cities.filter((city) => city.status === "available").length,
            occupied: cities.filter((city) => city.status === "occupied").length,
            reserved: cities.filter((city) => city.status === "reserved").length,
        };
    }, [overview]);
    const revenue = activeSubscriptions.reduce((sum, item) => sum + item.amount, 0);
    const adsBudget = activeSubscriptions.reduce((sum, item) => sum + item.adsBudget, 0);

    function openCreateCity() {
        setEditingCityId(null);
        setCityForm(emptyCityForm);
        setCitySaveError("");
        setCampaignValidation({ loading: false, ok: false, message: "" });
        setCityModalOpen(true);
    }

    function openEditCity(city: SubscriptionCity) {
        setEditingCityId(city.id);
        setCityForm({
            id: city.id,
            name: city.name,
            state: city.state || "",
            country: city.country || "Brasil",
            status: city.status,
            campaignId: city.campaignId || city.baseCampaignId || "",
        });
        setCitySaveError("");
        setCampaignValidation({ loading: false, ok: false, message: "" });
        setCityModalOpen(true);
    }

    async function saveCity() {
        try {
            setCitySaving(true);
            setCitySaveError("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/cities", {
                method: editingCityId ? "PATCH" : "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(cityForm),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo guardar la ciudad.");
            setCityModalOpen(false);
            await loadOverview();
        } catch (err) {
            setCitySaveError(err instanceof Error ? err.message : "No se pudo guardar la ciudad.");
        } finally {
            setCitySaving(false);
        }
    }

    async function validateCampaign() {
        try {
            setCampaignValidation({ loading: true, ok: false, message: "" });
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/validate-campaign", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ campaignId: cityForm.campaignId }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo validar la campana.");
            setCampaignValidation({
                loading: false,
                ok: data.campaign.ready !== false,
                message: [
                    data.campaign.name,
                    data.campaign.status || "sin estado",
                    `${data.campaign.adsetsCount ?? 0} ad set`,
                    `${data.campaign.adsCount ?? 0} anuncio`,
                    data.campaign.warning || "",
                ].filter(Boolean).join(" · "),
            });
        } catch (err) {
            setCampaignValidation({
                loading: false,
                ok: false,
                message: err instanceof Error ? err.message : "No se pudo validar la campana.",
            });
        }
    }

    async function saveSettings() {
        try {
            setSettingsSaving(true);
            setSettingsError("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/settings", {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(settingsDraft),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo guardar la configuracion.");
            await loadOverview();
        } catch (err) {
            setSettingsError(err instanceof Error ? err.message : "No se pudo guardar la configuracion.");
        } finally {
            setSettingsSaving(false);
        }
    }

    async function retryCheckout(checkoutId: string) {
        try {
            setActionBusyId(checkoutId);
            setActionMessage("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/retry-meta", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ checkoutId }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo reintentar Meta.");
            setActionMessage("Activacion Meta reintentada correctamente.");
            await loadOverview();
        } catch (err) {
            setActionMessage(err instanceof Error ? humanizeError(err.message) : "No se pudo reintentar Meta.");
        } finally {
            setActionBusyId("");
        }
    }

    async function releaseCity(cityId: string) {
        const ok = window.confirm("Esto pausa la campana activa/reservada y libera la ciudad. Continuar?");
        if (!ok) return;

        try {
            setActionBusyId(cityId);
            setActionMessage("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/release-city", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ cityId }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo liberar la ciudad.");
            setActionMessage("Ciudad liberada correctamente.");
            await loadOverview();
        } catch (err) {
            setActionMessage(err instanceof Error ? humanizeError(err.message) : "No se pudo liberar la ciudad.");
        } finally {
            setActionBusyId("");
        }
    }

    if (!canView) {
        return <EmptyState title="Sin permiso" body="No tienes permiso para ver suscripciones." />;
    }

    return (
        <div className="space-y-4">
            <PageHeader
                title="Suscripciones"
                subtitle="Panel operativo para ciudades, campañas Meta, pagos Pix y ciclos activos."
                icon={<AppIcon name="wallet" tone="purple" plain className="text-white" />}
                actions={
                    <div className="flex items-center gap-2">
                        {canManageCities ? (
                            <Button type="button" variant="primary" onClick={openCreateCity}>
                                <AppIcon name="plus" size="sm" plain className="h-4 w-4 text-current" />
                                Ciudad
                            </Button>
                        ) : null}
                        <Button type="button" variant="secondary" onClick={loadOverview}>
                            <AppIcon name="refresh" size="sm" plain className="h-4 w-4 text-current" />
                            Actualizar
                        </Button>
                    </div>
                }
            />

            {error ? <Notice tone="red">{error}</Notice> : null}
            {actionMessage ? <Notice tone={actionMessage.includes("correctamente") ? "green" : "red"}>{actionMessage}</Notice> : null}
            {loading ? <Notice tone="violet">Cargando panel operativo...</Notice> : null}

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Metric label="Ciudades" value={cityStats.total} detail={`${cityStats.available} disponibles · ${cityStats.occupied} ocupadas`} tone="purple" />
                <Metric label="Reservas" value={cityStats.reserved} detail="Pix iniciados aun no aprobados" tone="orange" />
                <Metric label="Activas" value={activeSubscriptions.length} detail="Suscripciones en curso" tone="green" />
                <Metric label="Ingresos activos" value={currency.format(revenue)} detail={`${currency.format(adsBudget)} en anuncios`} tone="blue" />
            </section>

            <section className="grid gap-3 xl:grid-cols-[1fr_360px]">
                <Card>
                    <CardHeader title="Ciudades y campanas" subtitle="Cada ciudad apunta a una campana fija de Meta." />
                    <CardContent className="grid gap-2">
                        {(overview?.cities ?? []).map((city) => (
                            <CityRow
                                key={city.id}
                                city={city}
                                subscription={activeSubscriptions.find((item) => item.cityId === city.id)}
                                canEdit={canManageCities}
                                busy={actionBusyId === city.id}
                                onEdit={() => openEditCity(city)}
                                onRelease={() => releaseCity(city.id)}
                            />
                        ))}
                        {overview?.cities.length === 0 ? <EmptyInline text="Aun no hay ciudades configuradas." /> : null}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader title="Reglas comerciales" subtitle="Configuracion global para nuevos ciclos." />
                    <CardContent className="space-y-3">
                        <Field label="Porcentaje para anuncios">
                            <div className="flex items-center gap-3">
                                <input
                                    type="range"
                                    min={10}
                                    max={90}
                                    value={Math.round(settingsDraft.adsShare * 100)}
                                    disabled={!canManageCities}
                                    onChange={(e) => setSettingsDraft((current) => ({ ...current, adsShare: Number(e.target.value) / 100 }))}
                                    className="w-full accent-[#7c3aed]"
                                />
                                <span className="w-12 text-right text-[13px] font-black text-[#101936]">{Math.round(settingsDraft.adsShare * 100)}%</span>
                            </div>
                        </Field>
                        <Field label="Duracion del ciclo">
                            <input
                                type="number"
                                min={1}
                                max={30}
                                value={settingsDraft.cycleDays}
                                disabled={!canManageCities}
                                onChange={(e) => setSettingsDraft((current) => ({ ...current, cycleDays: Number(e.target.value) }))}
                                className="h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold outline-none disabled:bg-[#f8f7ff]"
                            />
                        </Field>
                        <div className="grid grid-cols-2 gap-2">
                            <MoneyTile label="Anuncios" value={settingsDraft.adsShare * 100} suffix="%" />
                            <MoneyTile label="TrackGo" value={(1 - settingsDraft.adsShare) * 100} suffix="%" />
                        </div>
                        {settingsError ? <Notice tone="red">{settingsError}</Notice> : null}
                        <Button type="button" variant="primary" className="w-full" disabled={!canManageCities || settingsSaving} onClick={saveSettings}>
                            {settingsSaving ? "Guardando..." : "Guardar reglas"}
                        </Button>
                    </CardContent>
                </Card>
            </section>

            <section className="grid gap-3 xl:grid-cols-[1fr_1fr]">
                <Card>
                    <CardHeader title="Suscripciones activas" subtitle="Quien compro, cuando termina y cuanto invirtio." />
                    <CardContent className="space-y-2">
                        {activeSubscriptions.map((item) => <SubscriptionRow key={item.id} item={item} />)}
                        {activeSubscriptions.length === 0 ? <EmptyInline text="No hay suscripciones activas." /> : null}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader title="Pagos recientes" subtitle="Checkouts Pix, errores y activaciones Meta." />
                    <CardContent className="space-y-2">
                        {(overview?.checkouts ?? []).slice(0, 12).map((item) => (
                            <CheckoutRow
                                key={item.id}
                                item={item}
                                canRetry={canManageCities}
                                busy={actionBusyId === item.id}
                                onRetry={() => retryCheckout(item.id)}
                            />
                        ))}
                        {overview?.checkouts.length === 0 ? <EmptyInline text="No hay pagos recientes." /> : null}
                    </CardContent>
                </Card>
            </section>

            <CityConfigModal
                open={cityModalOpen}
                form={cityForm}
                editing={Boolean(editingCityId)}
                saving={citySaving}
                error={citySaveError}
                campaignValidation={campaignValidation}
                onChange={(patch) => setCityForm((current) => ({ ...current, ...patch }))}
                onValidateCampaign={validateCampaign}
                onSave={saveCity}
                onClose={() => setCityModalOpen(false)}
            />
        </div>
    );
}

function CityRow({
    city,
    subscription,
    canEdit,
    busy,
    onEdit,
    onRelease,
}: {
    city: SubscriptionCity;
    subscription?: OverviewSubscription;
    canEdit: boolean;
    busy: boolean;
    onEdit: () => void;
    onRelease: () => void;
}) {
    return (
        <div className="grid gap-3 rounded-2xl border border-[#eef1f5] bg-white p-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-black text-[#101936]">{city.name}</p>
                    <StatusPill status={city.status} />
                </div>
                <p className="mt-0.5 text-[11px] font-semibold text-[#66739a]">{[city.state, city.country].filter(Boolean).join(" · ") || "Sin region"}</p>
                <p className="mt-1 truncate font-mono text-[10px] font-bold text-[#98a2b3]">Meta {city.campaignId || city.baseCampaignId || "sin campaignId"}</p>
                {subscription ? (
                    <p className="mt-1 text-[11px] font-bold text-[#6d28d9]">
                        Ocupada por {subscription.userName} hasta {formatDate(subscription.endDate)}
                    </p>
                ) : null}
            </div>
            {canEdit ? (
                <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onEdit}>
                        <AppIcon name="edit" size="sm" plain className="h-4 w-4 text-current" />
                        Editar
                    </Button>
                    {city.status !== "available" ? (
                        <Button type="button" variant="danger" disabled={busy} onClick={onRelease}>
                            <AppIcon name="unlock" size="sm" plain className="h-4 w-4 text-current" />
                            {busy ? "..." : "Liberar"}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function SubscriptionRow({ item }: { item: OverviewSubscription }) {
    return (
        <div className="rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-[13px] font-black text-[#101936]">{item.userName}</p>
                    <p className="text-[11px] font-semibold text-[#66739a]">{item.city || item.cityId} · {item.plan}</p>
                </div>
                <span className="text-[13px] font-black text-[#6d28d9]">{currency.format(item.amount)}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-bold text-[#66739a]">
                <span>Ads {currency.format(item.adsBudget)}</span>
                <span className="text-right">Fin {formatDate(item.endDate)}</span>
            </div>
        </div>
    );
}

function CheckoutRow({
    item,
    canRetry,
    busy,
    onRetry,
}: {
    item: OverviewCheckout;
    canRetry: boolean;
    busy: boolean;
    onRetry: () => void;
}) {
    const failed = item.status === "failed" || item.activationStatus.includes("failed");
    const canRetryMeta = canRetry && item.status === "approved" && item.activationStatus === "meta_failed";
    return (
        <div className="rounded-2xl border border-[#eef1f5] bg-white p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-[13px] font-black text-[#101936]">{item.cityName || "Ciudad"}</p>
                    <p className="text-[11px] font-semibold text-[#66739a]">{item.userName} · {formatDate(item.updatedAt)}</p>
                </div>
                <StatusPill status={item.activationStatus} />
            </div>
            <p className="mt-1 text-[12px] font-black text-[#101936]">{currency.format(item.amount)} · ads {currency.format(item.adsBudget)}</p>
            {failed && item.failureReason ? (
                <p className="mt-1 line-clamp-2 text-[10px] font-bold text-red-600">{humanizeError(item.failureReason)}</p>
            ) : null}
            {canRetryMeta ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={onRetry} className="mt-2 w-full">
                    <AppIcon name="refresh" size="sm" plain className="h-4 w-4 text-current" />
                    {busy ? "Reintentando..." : "Reintentar Meta"}
                </Button>
            ) : null}
        </div>
    );
}

function Metric({ label, value, detail, tone }: { label: string; value: ReactNode; detail: string; tone: "purple" | "orange" | "green" | "blue" }) {
    const toneClass = {
        purple: "from-violet-50 to-white text-violet-700",
        orange: "from-orange-50 to-white text-orange-700",
        green: "from-emerald-50 to-white text-emerald-700",
        blue: "from-blue-50 to-white text-blue-700",
    }[tone];
    return (
        <div className={`rounded-3xl border border-[#e8e7fb] bg-gradient-to-br ${toneClass} p-4 shadow-[0_16px_34px_rgba(91,33,255,0.06)]`}>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-75">{label}</p>
            <p className="mt-2 text-[28px] font-black tracking-[-0.05em] text-[#101936]">{value}</p>
            <p className="mt-1 text-[11px] font-bold text-[#66739a]">{detail}</p>
        </div>
    );
}

function StatusPill({ status }: { status: string }) {
    const normalized = status || "unknown";
    const classes =
        normalized === "available" || normalized === "active" || normalized === "approved"
            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
            : normalized === "occupied" || normalized === "reserved" || normalized === "processing" || normalized === "waiting_payment"
                ? "bg-amber-50 text-amber-700 ring-amber-100"
                : normalized.includes("failed") || normalized === "meta_failed"
                    ? "bg-red-50 text-red-700 ring-red-100"
                    : "bg-slate-50 text-slate-700 ring-slate-100";
    return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ring-1 ${classes}`}>{normalized}</span>;
}

function MoneyTile({ label, value, suffix }: { label: string; value: number; suffix: string }) {
    return (
        <div className="rounded-2xl bg-[#f8f7ff] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#66739a]">{label}</p>
            <p className="mt-1 text-[20px] font-black tracking-[-0.04em] text-[#101936]">{Math.round(value)}{suffix}</p>
        </div>
    );
}

function CityConfigModal({
    open,
    form,
    editing,
    saving,
    error,
    campaignValidation,
    onChange,
    onValidateCampaign,
    onSave,
    onClose,
}: {
    open: boolean;
    form: CityFormState;
    editing: boolean;
    saving: boolean;
    error: string;
    campaignValidation: { loading: boolean; ok: boolean; message: string };
    onChange: (patch: Partial<CityFormState>) => void;
    onValidateCampaign: () => void;
    onSave: () => void;
    onClose: () => void;
}) {
    return (
        <Modal open={open} title={editing ? "Editar ciudad" : "Nueva ciudad"} subtitle="Configura ciudad y campana fija de Meta." size="md" onClose={onClose}>
            <div className="space-y-4">
                <Notice tone="violet">
                    <span className="font-black text-[#101936]">campaignId</span> es la campana fija de esa ciudad. TrackGo ajusta presupuesto/fecha y activa la campana cuando el Pix se aprueba.
                </Notice>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="ID interno">
                        <input value={form.id} disabled={editing} onChange={(e) => onChange({ id: e.target.value })} placeholder="belem" className={inputClass} />
                    </Field>
                    <Field label="Ciudad">
                        <input value={form.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Belém" className={inputClass} />
                    </Field>
                    <Field label="Estado">
                        <input value={form.state} onChange={(e) => onChange({ state: e.target.value })} placeholder="Pará" className={inputClass} />
                    </Field>
                    <Field label="Pais">
                        <input value={form.country} onChange={(e) => onChange({ country: e.target.value })} placeholder="Brasil" className={inputClass} />
                    </Field>
                    <Field label="Estado comercial">
                        <select value={form.status} onChange={(e) => onChange({ status: e.target.value as CityFormState["status"] })} className={inputClass}>
                            <option value="available">Disponible</option>
                            <option value="reserved">Reservada</option>
                            <option value="occupied">Ocupada</option>
                        </select>
                    </Field>
                    <Field label="ID campana Meta">
                        <div className="flex gap-2">
                            <input value={form.campaignId} onChange={(e) => onChange({ campaignId: e.target.value })} placeholder="120..." className={`${inputClass} min-w-0 flex-1 font-mono`} />
                            <button type="button" onClick={onValidateCampaign} disabled={campaignValidation.loading || !form.campaignId.trim()} className="h-11 rounded-2xl border border-[#ded8ff] bg-[#f7f3ff] px-3 text-[11px] font-black text-[#6d28d9] disabled:opacity-50">
                                {campaignValidation.loading ? "..." : "Validar"}
                            </button>
                        </div>
                    </Field>
                </div>
                {campaignValidation.message ? <Notice tone={campaignValidation.ok ? "green" : "red"}>{campaignValidation.message}</Notice> : null}
                {error ? <Notice tone="red">{error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
                    <Button type="button" variant="primary" disabled={saving} onClick={onSave}>{saving ? "Guardando..." : "Guardar ciudad"}</Button>
                </div>
            </div>
        </Modal>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-[#66739a]">{label}</span>
            {children}
        </label>
    );
}

function Notice({ tone, children }: { tone: "violet" | "red" | "green"; children: ReactNode }) {
    const cls = tone === "red" ? "border-red-100 bg-red-50 text-red-700" : tone === "green" ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-[#ded8ff] bg-[#fbfaff] text-[#52607a]";
    return <div className={`rounded-2xl border p-3 text-[12px] font-semibold leading-snug ${cls}`}>{children}</div>;
}

function EmptyInline({ text }: { text: string }) {
    return <div className="rounded-2xl border border-dashed border-[#ded8ff] bg-[#fbfaff] p-4 text-center text-[12px] font-bold text-[#66739a]">{text}</div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
    return <div className="rounded-3xl border border-[#e8e7fb] bg-white p-6 text-center"><p className="text-[16px] font-black text-[#101936]">{title}</p><p className="mt-1 text-[13px] font-semibold text-[#66739a]">{body}</p></div>;
}

function formatDate(value?: number | null) {
    return value ? dateTime.format(new Date(value)) : "sin fecha";
}

function humanizeError(message: string) {
    if (!message) return "No se pudo completar la operacion.";
    if (message.includes("WhatsApp")) {
        return "Meta requiere que el conjunto de anuncios tenga el numero de WhatsApp correctamente conectado.";
    }
    if (message.includes("Invalid parameter")) {
        return message.split("|").map((part) => part.trim()).filter(Boolean).slice(1, 3).join(" · ") || "Meta rechazo algun parametro de la campana.";
    }
    if (message.includes("city_reserved_by_you")) {
        return "Ya existe un Pix pendiente para esta ciudad.";
    }
    return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

function getAuthToken() {
    if (auth.currentUser) return auth.currentUser.getIdToken();
    return new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            unsubscribe();
            reject(new Error("No se pudo confirmar la sesion activa."));
        }, 8000);
        const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
            if (!user) return;
            window.clearTimeout(timeout);
            unsubscribe();
            user.getIdToken().then(resolve, reject);
        });
    });
}
