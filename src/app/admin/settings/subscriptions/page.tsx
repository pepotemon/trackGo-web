"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { listAdminUsers } from "@/data/usersRepo";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePermissions } from "@/features/auth/usePermissions";
import { SUBSCRIPTION_PLANS } from "@/lib/subscriptionPlans";
import type { SubscriptionCity, SubscriptionPlanId } from "@/types/subscriptions";
import type { UserDoc } from "@/types/users";

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

type ManualSubscriptionForm = {
    userId: string;
    cityId: string;
    plan: SubscriptionPlanId;
    amount: number;
    cycleDays: number;
    syncMeta: boolean;
};

type OverviewSubscription = {
    id: string;
    userId?: string | null;
    userName: string;
    userEmail?: string;
    cityId?: string | null;
    city?: string | null;
    plan?: string | null;
    amount: number;
    adsBudget: number;
    dailyBudget?: number | null;
    targetSpend?: number | null;
    spendPauseThreshold?: number | null;
    cycleSpend?: number | null;
    todaySpend?: number | null;
    totalSpend?: number | null;
    spendUpdatedAt?: number | null;
    spendStatus?: string | null;
    campaignName?: string | null;
    campaignId?: string | null;
    status: string;
    source?: string | null;
    sharedPool?: boolean | null;
    startDate?: number | null;
    endDate?: number | null;
};

type OverviewCheckout = {
    id: string;
    userId?: string | null;
    cityId?: string | null;
    cityName?: string | null;
    userName: string;
    userEmail?: string;
    plan?: string | null;
    amount: number;
    adsBudget: number;
    paymentId?: string;
    ticketUrl?: string | null;
    status: string;
    activationStatus: string;
    failureReason?: string | null;
    hiddenFromUser?: boolean;
    createdAt?: number | null;
    updatedAt?: number | null;
    paymentApprovedAt?: number | null;
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
const defaultManualForm: ManualSubscriptionForm = {
    userId: "",
    cityId: "",
    plan: "crecimiento",
    amount: 400,
    cycleDays: 5,
    syncMeta: true,
};

const inputClass =
    "h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold text-[#101936] outline-none transition focus:border-[#8b5cf6] focus:ring-4 focus:ring-[#ede9fe] disabled:bg-[#f8f7ff] disabled:text-[#98a2b3]";
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function SubscriptionsAdminPage() {
    const permissions = usePermissions();
    const { isSuperAdmin } = useAuth();
    const [overview, setOverview] = useState<Overview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [actionMessage, setActionMessage] = useState("");
    const [actionBusyId, setActionBusyId] = useState("");
    const [cityModalOpen, setCityModalOpen] = useState(false);
    const [settingsModalOpen, setSettingsModalOpen] = useState(false);
    const [editingCityId, setEditingCityId] = useState<string | null>(null);
    const [cityForm, setCityForm] = useState<CityFormState>(emptyCityForm);
    const [citySaving, setCitySaving] = useState(false);
    const [citySaveError, setCitySaveError] = useState("");
    const [campaignValidation, setCampaignValidation] = useState({ loading: false, ok: false, message: "" });
    const [settingsDraft, setSettingsDraft] = useState<SubscriptionSettings>({ adsShare: 0.5, cycleDays: 5 });
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsError, setSettingsError] = useState("");
    const [detailCityId, setDetailCityId] = useState<string | null>(null);
    const [sheetCityId, setSheetCityId] = useState<string | null>(null);
    const [manualModalOpen, setManualModalOpen] = useState(false);
    const [manualUsers, setManualUsers] = useState<UserDoc[]>([]);
    const [manualUsersLoading, setManualUsersLoading] = useState(false);
    const [manualForm, setManualForm] = useState<ManualSubscriptionForm>(defaultManualForm);
    const [manualSaving, setManualSaving] = useState(false);
    const [manualError, setManualError] = useState("");

    const canView = permissions.subscriptionsView || permissions.subscriptionsEdit;
    const canManage = permissions.subscriptionsEdit || isSuperAdmin;

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
                settings: data.settings || { adsShare: 0.5, cycleDays: 5 },
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
        const timer = window.setTimeout(() => {
            void loadOverview();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadOverview]);

    const activeSubscriptions = useMemo(
        () => overview?.subscriptions.filter((item) => item.status === "active" || item.status === "expiring" || item.status === "paused") ?? [],
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
    const failedCheckouts = overview?.checkouts.filter((item) => item.status === "failed" || item.activationStatus.includes("failed")).length ?? 0;

    const sheetCity = useMemo(
        () => sheetCityId ? (overview?.cities.find((c) => c.id === sheetCityId) ?? null) : null,
        [sheetCityId, overview],
    );
    const sheetSub = useMemo(
        () => sheetCityId ? (activeSubscriptions.find((s) => s.cityId === sheetCityId) ?? undefined) : undefined,
        [sheetCityId, activeSubscriptions],
    );

    const detailCity = useMemo(
        () => detailCityId ? (overview?.cities.find((c) => c.id === detailCityId) ?? null) : null,
        [detailCityId, overview],
    );
    const detailSubscription = useMemo(
        () => detailCityId
            ? (overview?.subscriptions.find((s) => s.cityId === detailCityId && ["active", "provisioning", "payment_approved_meta_failed"].includes(s.status)) ?? null)
            : null,
        [detailCityId, overview],
    );
    const detailSubscriptions = useMemo(
        () => detailCityId
            ? (overview?.subscriptions.filter((s) => s.cityId === detailCityId && ["active", "paused", "provisioning", "payment_approved_meta_failed"].includes(s.status)) ?? [])
            : [],
        [detailCityId, overview],
    );
    const detailCheckout = useMemo(
        () => detailCityId
            ? ([...(overview?.checkouts.filter((c) => c.cityId === detailCityId) ?? [])].sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))[0] ?? null)
            : null,
        [detailCityId, overview],
    );

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
            campaignId: city.campaignId || city.activeCampaignId || city.baseCampaignId || "",
        });
        setCitySaveError("");
        setCampaignValidation({ loading: false, ok: false, message: "" });
        setCityModalOpen(true);
    }

    async function openManualActivation() {
        setManualError("");
        setManualForm({
            ...defaultManualForm,
            cycleDays: overview?.settings.cycleDays ?? defaultManualForm.cycleDays,
        });
        setManualModalOpen(true);
        if (manualUsers.length > 0) return;
        try {
            setManualUsersLoading(true);
            const users = await listAdminUsers();
            setManualUsers(users.filter((item) => item.role === "user" && item.active !== false));
        } catch (err) {
            setManualError(err instanceof Error ? err.message : "No se pudieron cargar vendedores.");
        } finally {
            setManualUsersLoading(false);
        }
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
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo validar la configuracion.");
            setCampaignValidation({
                loading: false,
                ok: data.campaign.ready !== false,
                message: [
                    data.campaign.name,
                    data.campaign.status || "sin estado",
                    `${data.campaign.adsetsCount ?? 0} grupos`,
                    `${data.campaign.adsCount ?? 0} piezas`,
                    data.campaign.warning || "",
                ]
                    .filter(Boolean)
                    .join(" - "),
            });
        } catch (err) {
            setCampaignValidation({
                loading: false,
                ok: false,
                message: err instanceof Error ? err.message : "No se pudo validar la configuracion.",
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
            setSettingsModalOpen(false);
            await loadOverview();
        } catch (err) {
            setSettingsError(err instanceof Error ? err.message : "No se pudo guardar la configuracion.");
        } finally {
            setSettingsSaving(false);
        }
    }

    async function activateManual() {
        try {
            setManualSaving(true);
            setManualError("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/manual-activate", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(manualForm),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo activar la suscripcion.");
            setManualModalOpen(false);
            setActionMessage("Suscripcion manual activada correctamente.");
            await loadOverview();
        } catch (err) {
            setManualError(err instanceof Error ? humanizeError(err.message) : "No se pudo activar la suscripcion.");
        } finally {
            setManualSaving(false);
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
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo reintentar.");
            setActionMessage("Activacion reintentada correctamente.");
            await loadOverview();
        } catch (err) {
            setActionMessage(err instanceof Error ? humanizeError(err.message) : "No se pudo reintentar.");
        } finally {
            setActionBusyId("");
        }
    }

    async function releaseCity(cityId: string) {
        if (!window.confirm("Esto libera la ciudad y cierra el ciclo activo. Continuar?")) return;
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

    async function deleteCity(city: SubscriptionCity) {
        if (city.status !== "available") {
            setActionMessage("Primero libera la ciudad antes de eliminarla.");
            return;
        }
        if (!window.confirm(`Eliminar la ciudad "${city.name}"? Esta accion no se puede deshacer.`)) return;
        try {
            setActionBusyId(`delete:${city.id}`);
            setActionMessage("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/cities", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ cityId: city.id }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo eliminar la ciudad.");
            setActionMessage("Ciudad eliminada correctamente.");
            if (detailCityId === city.id) setDetailCityId(null);
            if (sheetCityId === city.id) setSheetCityId(null);
            await loadOverview();
        } catch (err) {
            setActionMessage(err instanceof Error ? humanizeError(err.message) : "No se pudo eliminar la ciudad.");
        } finally {
            setActionBusyId("");
        }
    }

    async function hideCheckoutNotice(checkoutId: string) {
        try {
            setActionBusyId(checkoutId);
            setActionMessage("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/hide-checkout", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ checkoutId }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "No se pudo ocultar el aviso.");
            setActionMessage("Aviso ocultado para el vendedor.");
            await loadOverview();
        } catch (err) {
            setActionMessage(err instanceof Error ? humanizeError(err.message) : "No se pudo ocultar el aviso.");
        } finally {
            setActionBusyId("");
        }
    }

    async function updateCampaignDelivery(cityId: string, status: "active" | "paused") {
        const label = status === "paused" ? "pausar" : "reanudar";
        if (!window.confirm(`Esto va a ${label} la campana en Meta para esta ciudad. Continuar?`)) return;
        try {
            setActionBusyId(`${cityId}:${status}`);
            setActionMessage("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/campaign-delivery", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ cityId, status }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || `No se pudo ${label} la campana.`);
            setActionMessage(status === "paused" ? "Campana pausada correctamente." : "Campana reanudada correctamente.");
            await loadOverview();
        } catch (err) {
            setActionMessage(err instanceof Error ? humanizeError(err.message) : `No se pudo ${label} la campana.`);
        } finally {
            setActionBusyId("");
        }
    }

    async function updateParticipantDelivery(subscriptionId: string, status: "active" | "paused") {
        const label = status === "paused" ? "pausar este vendedor" : "reanudar este vendedor";
        if (!window.confirm(`Esto va a ${label} dentro de la bolsa compartida. Continuar?`)) return;
        try {
            setActionBusyId(`participant:${subscriptionId}:${status}`);
            setActionMessage("");
            const token = await getAuthToken();
            const response = await fetch("/api/subscriptions/participant-delivery", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ subscriptionId, status }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || `No se pudo ${status === "paused" ? "pausar" : "reanudar"} el vendedor.`);
            setActionMessage(status === "paused" ? "Vendedor pausado y presupuesto recalculado." : "Vendedor reanudado y presupuesto recalculado.");
            await loadOverview();
        } catch (err) {
            setActionMessage(err instanceof Error ? humanizeError(err.message) : `No se pudo ${status === "paused" ? "pausar" : "reanudar"} el vendedor.`);
        } finally {
            setActionBusyId("");
        }
    }

    if (!canView) {
        return <EmptyState title="Sin permiso" body="No tienes permiso para ver suscripciones." />;
    }

    return (
        <div className="space-y-3 pb-4">
            <div className="sticky top-0 z-20 -mx-3 bg-[#fbfaff]/95 px-3 pb-3 pt-3 backdrop-blur-md sm:-mx-5 sm:px-5 lg:-mx-7 lg:px-7">
                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-[20px] font-black tracking-[-0.03em] text-[#101936]">Suscripciones</h1>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739a]">Ciudades · Pix · Ciclos activos</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {canManage ? (
                            <>
                                <Button type="button" variant="secondary" onClick={() => setSettingsModalOpen(true)}>
                                    <AppIcon name="settings" size="sm" plain className="h-4 w-4 text-current" />
                                    <span className="hidden sm:inline">Reglas</span>
                                </Button>
                                <Button type="button" variant="secondary" onClick={openManualActivation}>
                                    <AppIcon name="wallet" size="sm" plain className="h-4 w-4 text-current" />
                                    <span className="hidden sm:inline">Manual</span>
                                </Button>
                                <Button type="button" variant="primary" onClick={openCreateCity}>
                                    <AppIcon name="plus" size="sm" plain className="h-4 w-4 text-current" />
                                    <span className="hidden sm:inline">Ciudad</span>
                                </Button>
                            </>
                        ) : null}
                        <Button type="button" variant="secondary" onClick={loadOverview} aria-label="Actualizar">
                            <AppIcon name="refresh" size="sm" plain className="h-4 w-4 text-current" />
                        </Button>
                    </div>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2">
                    <StatCard label="Ciudades" value={cityStats.total} tone="purple" />
                    <StatCard label="Libres" value={cityStats.available} tone="green" />
                    <StatCard label="Ocupadas" value={cityStats.occupied} tone="blue" />
                    <StatCard label="Reservas" value={cityStats.reserved} tone="orange" />
                    <StatCard label="Alertas" value={failedCheckouts} tone={failedCheckouts ? "red" : "green"} />
                </div>
            </div>

            {error ? <Notice tone="red">{error}</Notice> : null}
            {actionMessage ? <Notice tone={actionMessage.includes("correctamente") ? "green" : "red"}>{actionMessage}</Notice> : null}
            {loading ? (
                <Card>
                    <CardContent>
                        <EmptyState title="Cargando suscripciones" body="Estamos preparando ciudades, ciclos activos y pagos recientes." />
                    </CardContent>
                </Card>
            ) : (
                <>
                    <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
                        <Card>
                            <CardHeader
                                title="Ciudades"
                                subtitle="Disponibilidad, responsable y configuracion operativa."
                                action={<StatusBadge>{cityStats.available} libres</StatusBadge>}
                            />
                            <CardContent className="grid gap-2">
                                {(overview?.cities ?? []).map((city) => (
                                    <CityCard
                                        key={city.id}
                                        city={city}
                                        subscription={activeSubscriptions.find((item) => item.cityId === city.id)}
                                        onSheet={() => setSheetCityId(city.id)}
                                    />
                                ))}
                                {overview?.cities.length === 0 ? <EmptyInline text="Aun no hay ciudades configuradas." /> : null}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader title="Ciclos activos" subtitle={`${currency.format(revenue)} en ciclos activos`} action={<StatusBadge>{activeSubscriptions.length}</StatusBadge>} />
                            <CardContent className="space-y-2">
                                {activeSubscriptions.map((item) => <SubscriptionRow key={item.id} item={item} />)}
                                {activeSubscriptions.length === 0 ? <EmptyInline text="No hay ciclos activos." /> : null}
                            </CardContent>
                        </Card>
                    </section>

                    <CampaignSpendPanel subscriptions={activeSubscriptions} onRefresh={loadOverview} loading={loading} />

                    <Card>
                        <CardHeader title="Pagos recientes" subtitle="Pix, reservas, activaciones y errores de operacion." />
                        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {(overview?.checkouts ?? []).slice(0, 12).map((item) => (
                                <CheckoutRow
                                    key={item.id}
                                    item={item}
                                    canRetry={canManage}
                                    busy={actionBusyId === item.id}
                                    onRetry={() => void retryCheckout(item.id)}
                                    onHide={() => void hideCheckoutNotice(item.id)}
                                />
                            ))}
                            {overview?.checkouts.length === 0 ? <EmptyInline text="No hay pagos recientes." /> : null}
                        </CardContent>
                    </Card>
                </>
            )}

            {sheetCity ? (
                <CityActionSheet
                    city={sheetCity}
                    subscription={sheetSub}
                    canManage={canManage}
                    canDelete={isSuperAdmin}
                    busy={actionBusyId === sheetCityId || actionBusyId === `delete:${sheetCity.id}`}
                    onDetail={() => { setDetailCityId(sheetCityId); setSheetCityId(null); }}
                    onEdit={() => { openEditCity(sheetCity); setSheetCityId(null); }}
                    onRelease={() => { void releaseCity(sheetCityId!); setSheetCityId(null); }}
                    onDelete={() => { void deleteCity(sheetCity); setSheetCityId(null); }}
                    onCampaignDelivery={(status) => { void updateCampaignDelivery(sheetCityId!, status); setSheetCityId(null); }}
                    onClose={() => setSheetCityId(null)}
                />
            ) : null}

            <CityDetailModal
                city={detailCity}
                subscription={detailSubscription}
                subscriptions={detailSubscriptions}
                checkout={detailCheckout}
                canManage={canManage}
                canDelete={isSuperAdmin}
                busy={actionBusyId === detailCityId || actionBusyId === `delete:${detailCityId}` || Boolean(detailCityId && actionBusyId.startsWith(`${detailCityId}:`))}
                onRelease={() => { if (detailCityId) void releaseCity(detailCityId); }}
                onDelete={() => { if (detailCity) void deleteCity(detailCity); }}
                onRetry={() => { if (detailCheckout) void retryCheckout(detailCheckout.id); }}
                onHideCheckout={() => { if (detailCheckout) void hideCheckoutNotice(detailCheckout.id); }}
                onCampaignDelivery={(status) => { if (detailCityId) void updateCampaignDelivery(detailCityId, status); }}
                onParticipantDelivery={(subscriptionId, status) => { void updateParticipantDelivery(subscriptionId, status); }}
                onClose={() => setDetailCityId(null)}
            />

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

            <RulesModal
                open={settingsModalOpen}
                draft={settingsDraft}
                saving={settingsSaving}
                error={settingsError}
                canEdit={canManage}
                onChange={setSettingsDraft}
                onSave={saveSettings}
                onClose={() => setSettingsModalOpen(false)}
            />

            <ManualActivationModal
                open={manualModalOpen}
                users={manualUsers}
                usersLoading={manualUsersLoading}
                cities={overview?.cities ?? []}
                settings={overview?.settings ?? { adsShare: 0.5, cycleDays: 5 }}
                form={manualForm}
                saving={manualSaving}
                error={manualError}
                onChange={setManualForm}
                onSave={activateManual}
                onClose={() => setManualModalOpen(false)}
            />
        </div>
    );
}

function CityCard({
    city,
    subscription,
    onSheet,
}: {
    city: SubscriptionCity;
    subscription?: OverviewSubscription;
    onSheet: () => void;
}) {
    const dotColor =
        city.status === "available"
            ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
            : city.status === "reserved"
              ? "bg-amber-400"
              : "bg-rose-400";
    return (
        <div className="flex items-center gap-3 rounded-[16px] border border-[#eef1f5] bg-white p-3 transition hover:border-[#ded8ff] hover:bg-[#fbfaff]">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-[14px] font-black text-[#101936]">{city.name}</p>
                    <StatusPill status={city.status} />
                </div>
                <p className="mt-0.5 text-[11px] font-semibold text-[#66739a]">
                    {[city.state, city.country].filter(Boolean).join(" · ") || "Sin region"}
                </p>
                {subscription ? (
                    <p className="mt-1 text-[11px] font-bold text-[#6d28d9]">
                        {subscription.userName} · fin {formatDate(subscription.endDate)}
                        {formatCountdown(subscription.endDate) ? (
                            <span className="ml-1.5 rounded-full bg-[#f4f0ff] px-1.5 py-0.5 text-[9px] font-black text-[#7c3aed]">
                                {formatCountdown(subscription.endDate)}
                            </span>
                        ) : null}
                    </p>
                ) : null}
            </div>
            <button
                type="button"
                onClick={onSheet}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[#e8e7fb] bg-[#f8f7ff] transition active:bg-[#f3f0ff]"
            >
                <AppIcon name="more" tone="slate" size="sm" plain className="h-4 w-4 text-[#66739a]" />
            </button>
        </div>
    );
}

function CityActionSheet({
    city,
    subscription,
    canManage,
    canDelete,
    busy,
    onDetail,
    onEdit,
    onRelease,
    onDelete,
    onCampaignDelivery,
    onClose,
}: {
    city: SubscriptionCity;
    subscription?: OverviewSubscription;
    canManage: boolean;
    canDelete: boolean;
    busy: boolean;
    onDetail: () => void;
    onEdit: () => void;
    onRelease: () => void;
    onDelete: () => void;
    onCampaignDelivery: (status: "active" | "paused") => void;
    onClose: () => void;
}) {
    const isOccupied = city.status === "occupied" || city.status === "reserved";
    const campaignPaused = city.campaignDeliveryStatus === "paused";
    const canDeleteCity = canDelete && city.status === "available";
    return (
        <>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="fixed inset-0 z-40 bg-black/40" />
            <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-[24px] bg-white px-4 pb-8 pt-4 shadow-[0_-8px_40px_rgba(0,0,0,0.18)] sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(420px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-4 sm:shadow-[0_28px_80px_rgba(16,25,54,0.24)]">
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-[#e8e7fb]" />
                <div className="mb-4 min-w-0">
                    <p className="truncate text-[15px] font-black text-[#101936]">{city.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <StatusPill status={city.status} />
                        {subscription ? (
                            <span className="text-[11px] font-bold text-[#66739a]">{subscription.userName}</span>
                        ) : null}
                    </div>
                </div>
                <div className="grid gap-2">
                    {isOccupied ? (
                        <button
                            type="button"
                            onClick={onDetail}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f3f0ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-violet-200"
                        >
                            <AppIcon name="search" size="sm" plain className="h-5 w-5 text-[#7c3aed]" />
                            Ver detalle del ciclo
                        </button>
                    ) : null}
                    {canManage ? (
                        <button
                            type="button"
                            onClick={onEdit}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f8f7ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-[#f3f0ff]"
                        >
                            <AppIcon name="edit" size="sm" plain className="h-5 w-5 text-[#66739a]" />
                            Editar ciudad
                        </button>
                    ) : null}
                    {canManage && city.status === "occupied" ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onCampaignDelivery(campaignPaused ? "active" : "paused")}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-[#f8f7ff] px-4 text-[14px] font-bold text-[#101936] transition active:bg-[#f3f0ff] disabled:opacity-50"
                        >
                            <AppIcon name={campaignPaused ? "play" : "pause"} size="sm" plain className="h-5 w-5 text-[#7c3aed]" />
                            {campaignPaused ? "Reanudar campana" : "Pausar campana"}
                        </button>
                    ) : null}
                    {canManage && city.status !== "available" ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={onRelease}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-red-50 px-4 text-[14px] font-bold text-red-700 transition active:bg-red-100 disabled:opacity-50"
                        >
                            <AppIcon name="unlock" size="sm" plain className="h-5 w-5 text-red-500" />
                            {busy ? "Liberando..." : "Liberar ciudad"}
                        </button>
                    ) : null}
                    {canDeleteCity ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={onDelete}
                            className="flex min-h-[52px] items-center gap-3 rounded-[14px] bg-red-50 px-4 text-[14px] font-bold text-red-700 transition active:bg-red-100 disabled:opacity-50"
                        >
                            <AppIcon name="trash" size="sm" plain className="h-5 w-5 text-red-500" />
                            {busy ? "Eliminando..." : "Eliminar ciudad"}
                        </button>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 min-h-[48px] w-full rounded-[14px] border border-[#e8e7fb] bg-[#f8f7ff] text-[14px] font-bold text-[#66739a] transition active:bg-[#f3f0ff]"
                >
                    Cancelar
                </button>
            </div>
        </>
    );
}

function SubscriptionRow({ item }: { item: OverviewSubscription }) {
    const isActive = item.status === "active";
    return (
        <div className={`rounded-2xl border p-3 ${isActive ? "border-emerald-100 bg-white" : "border-[#eef1f5] bg-[#fbfaff]"}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <StatusPill status={item.status} />
                <div className="flex items-center gap-1.5 text-right">
                    <span className="text-[10px] font-bold text-[#98a2b3]">{formatDate(item.endDate)}</span>
                    {formatCountdown(item.endDate) ? (
                        <span className="rounded-full bg-[#f4f0ff] px-2 py-0.5 text-[9px] font-black text-[#7c3aed]">
                            {formatCountdown(item.endDate)}
                        </span>
                    ) : null}
                </div>
            </div>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-black text-[#101936]">{item.city || item.cityId}</p>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-[#66739a]">
                        {item.userName}{item.source === "manual_admin" ? " - Manual" : ""}
                    </p>
                    {item.userEmail ? <p className="truncate text-[10px] font-semibold text-[#98a2b3]">{item.userEmail}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                    <p className="text-[18px] font-black tracking-[-0.04em] text-[#6d28d9]">{currency.format(item.amount)}</p>
                    <p className="mt-0.5 text-[10px] font-bold text-[#66739a]">inversion {currency.format(item.adsBudget)}</p>
                </div>
            </div>
        </div>
    );
}

function CampaignSpendPanel({
    subscriptions,
    onRefresh,
    loading,
}: {
    subscriptions: OverviewSubscription[];
    onRefresh: () => void;
    loading: boolean;
}) {
    const rows = subscriptions
        .filter((item) => item.campaignId || item.cycleSpend || item.todaySpend)
        .sort((a, b) => Number(b.todaySpend || 0) - Number(a.todaySpend || 0));

    const totals = rows.reduce(
        (acc, item) => ({
            today: acc.today + Number(item.todaySpend || 0),
            cycle: acc.cycle + Number(item.cycleSpend || 0),
            target: acc.target + Number(item.targetSpend || item.adsBudget || 0),
        }),
        { today: 0, cycle: 0, target: 0 },
    );

    return (
        <Card>
            <CardHeader
                title="Monitoreo Meta"
                subtitle="Gasto real diario y acumulado de campanas activas."
                action={
                    <Button type="button" variant="secondary" onClick={onRefresh} disabled={loading}>
                        <AppIcon name="refresh" size="sm" plain className="h-4 w-4 text-current" />
                        Actualizar
                    </Button>
                }
            />
            <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                    <SpendMetric label="Hoy" value={totals.today} tone="blue" />
                    <SpendMetric label="Ciclo" value={totals.cycle} tone="purple" />
                    <SpendMetric label="Meta" value={totals.target} tone="green" />
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                    {rows.map((item) => {
                        const target = Number(item.targetSpend || item.adsBudget || 0);
                        const cycle = Number(item.cycleSpend || 0);
                        const pct = target > 0 ? Math.min(100, Math.round((cycle / target) * 100)) : 0;
                        const status = item.spendStatus === "live" ? "En vivo" : item.spendStatus === "error" ? "Sin lectura" : "Guardado";
                        return (
                            <div key={item.id} className="rounded-2xl border border-[#e8e7fb] bg-white p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-[13px] font-black text-[#101936]">{item.city || item.cityId}</p>
                                        <p className="mt-0.5 truncate text-[11px] font-bold text-[#66739a]">{item.userName}</p>
                                        <p className="mt-0.5 truncate text-[10px] font-semibold text-[#98a2b3]">{item.campaignName || item.campaignId || "Sin campana"}</p>
                                    </div>
                                    <span className={[
                                        "shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase",
                                        item.spendStatus === "live" ? "bg-emerald-50 text-emerald-700" : item.spendStatus === "error" ? "bg-red-50 text-red-700" : "bg-[#f3f0ff] text-[#6d28d9]",
                                    ].join(" ")}>
                                        {status}
                                    </span>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                                    <SpendMetric label="Hoy" value={item.todaySpend || 0} tone="blue" compact />
                                    <SpendMetric label="Ciclo" value={cycle} tone="purple" compact />
                                    <SpendMetric label="Diario" value={item.dailyBudget || 0} tone="orange" compact />
                                </div>

                                <div className="mt-3">
                                    <div className="mb-1 flex items-center justify-between text-[10px] font-black text-[#66739a]">
                                        <span>{pct}% usado</span>
                                        <span>{currency.format(cycle)} / {currency.format(target)}</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-[#eef1f5]">
                                        <div
                                            className={pct >= 95 ? "h-full rounded-full bg-red-500" : pct >= 80 ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-[#7C3AED]"}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!rows.length ? <EmptyInline text="No hay campanas activas para monitorear." /> : null}
                </div>
            </CardContent>
        </Card>
    );
}

function SpendMetric({
    label,
    value,
    tone,
    compact = false,
}: {
    label: string;
    value: number;
    tone: "blue" | "purple" | "green" | "orange";
    compact?: boolean;
}) {
    const toneClass = {
        blue: "text-blue-700 bg-blue-50",
        purple: "text-[#6d28d9] bg-[#f3f0ff]",
        green: "text-emerald-700 bg-emerald-50",
        orange: "text-orange-700 bg-orange-50",
    }[tone];

    return (
        <div className={`rounded-2xl px-2 py-2 ${toneClass}`}>
            <p className="text-[9px] font-black uppercase tracking-[0.08em] opacity-75">{label}</p>
            <p className={`${compact ? "text-[13px]" : "text-[16px]"} mt-0.5 font-black tracking-[-0.04em]`}>
                {currency.format(value)}
            </p>
        </div>
    );
}

function CheckoutRow({
    item,
    canRetry,
    busy,
    onRetry,
    onHide,
}: {
    item: OverviewCheckout;
    canRetry: boolean;
    busy: boolean;
    onRetry: () => void;
    onHide: () => void;
}) {
    const failed = item.status === "failed" || item.activationStatus.includes("failed");
    const isPending = item.status === "pending";
    const isApproved = item.status === "approved" && !item.activationStatus.includes("failed");
    const canRetryActivation = canRetry && item.status === "approved" && item.activationStatus === "meta_failed";
    const canHideCheckout = canRetryActivation && item.hiddenFromUser !== true;

    const borderCls = failed
        ? "border-red-100 bg-red-50/40"
        : isPending
          ? "border-amber-100 bg-amber-50/40"
          : isApproved
            ? "border-emerald-100 bg-white"
            : "border-[#eef1f5] bg-white";

    return (
        <div className={`rounded-2xl border p-3 ${borderCls}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-black text-[#101936]">{item.cityName || "Ciudad"}</p>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-[#66739a]">{item.userName}</p>
                    <p className="text-[10px] font-semibold text-[#98a2b3]">{formatDate(item.updatedAt)}</p>
                </div>
                <div className="shrink-0 text-right">
                    <StatusPill status={item.activationStatus || item.status} />
                    <p className="mt-1.5 text-[16px] font-black tracking-[-0.04em] text-[#6d28d9]">{currency.format(item.amount)}</p>
                    <p className="text-[10px] font-bold text-[#66739a]">inversion {currency.format(item.adsBudget)}</p>
                </div>
            </div>
            {failed && item.failureReason ? (
                <p className="mt-2 line-clamp-2 rounded-xl bg-red-100 px-2.5 py-1.5 text-[10px] font-bold text-red-700">{humanizeError(item.failureReason)}</p>
            ) : null}
            {canRetryActivation ? (
                <div className="mt-2 grid gap-2">
                    <Button type="button" variant="secondary" disabled={busy} onClick={onRetry} className="w-full">
                        <AppIcon name="refresh" size="sm" plain className="h-4 w-4 text-current" />
                        {busy ? "Reintentando..." : "Reintentar"}
                    </Button>
                    {canHideCheckout ? (
                        <Button type="button" variant="ghost" disabled={busy} onClick={onHide} className="w-full">
                            Ocultar al vendedor
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function StatCard({
    label,
    value,
    tone,
}: {
    label: string;
    value: ReactNode;
    tone: "purple" | "green" | "orange" | "blue" | "red";
}) {
    const colorMap: Record<string, string> = {
        purple: "text-[#7c3aed]",
        green: "text-emerald-600",
        orange: "text-amber-600",
        blue: "text-blue-600",
        red: "text-red-600",
    };
    return (
        <div className="rounded-[14px] border border-[#e8e7fb] bg-white px-1.5 py-2.5 text-center shadow-[0_4px_16px_rgba(91,33,255,0.06)]">
            <p className={`text-[18px] font-black leading-none tracking-[-0.04em] ${colorMap[tone] ?? "text-[#101936]"}`}>{value}</p>
            <p className="mt-1 text-[9px] font-black uppercase tracking-[0.06em] text-[#66739a]">{label}</p>
        </div>
    );
}

function RulesModal({
    open,
    draft,
    saving,
    error,
    canEdit,
    onChange,
    onSave,
    onClose,
}: {
    open: boolean;
    draft: SubscriptionSettings;
    saving: boolean;
    error: string;
    canEdit: boolean;
    onChange: (next: SubscriptionSettings) => void;
    onSave: () => void;
    onClose: () => void;
}) {
    const operatingPercent = Math.round(draft.adsShare * 100);
    const trackgoPercent = 100 - operatingPercent;

    return (
        <Modal open={open} title="Reglas comerciales" subtitle="Configuracion global para nuevos ciclos." size="md" onClose={onClose}>
            <div className="space-y-4">
                <div className="rounded-2xl border border-[#e8e7fb] bg-[#fbfaff] p-3 text-[12px] font-semibold leading-snug text-[#66739a]">
                    Estas reglas definen como se divide cada pago y cuantos dias dura el periodo operativo de una suscripcion nueva.
                </div>

                <Field label="Porcentaje operativo">
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min={10}
                            max={90}
                            value={operatingPercent}
                            disabled={!canEdit}
                            onChange={(event) => onChange({ ...draft, adsShare: Number(event.target.value) / 100 })}
                            className="w-full accent-[#7c3aed]"
                        />
                        <span className="w-12 text-right text-[13px] font-black text-[#101936]">{operatingPercent}%</span>
                    </div>
                </Field>

                <Field label="Duracion del ciclo en dias">
                    <input
                        type="number"
                        min={1}
                        max={30}
                        value={draft.cycleDays}
                        disabled={!canEdit}
                        onChange={(event) => onChange({ ...draft, cycleDays: Number(event.target.value) })}
                        className={inputClass}
                    />
                </Field>

                <div className="grid grid-cols-2 gap-2">
                    <MoneyTile label="Operacion" value={`${operatingPercent}%`} />
                    <MoneyTile label="TrackGo" value={`${trackgoPercent}%`} />
                </div>

                {error ? <Notice tone="red">{error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
                    <Button type="button" variant="primary" disabled={!canEdit || saving} onClick={onSave}>
                        {saving ? "Guardando..." : "Guardar reglas"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function ManualActivationModal({
    open,
    users,
    usersLoading,
    cities,
    settings,
    form,
    saving,
    error,
    onChange,
    onSave,
    onClose,
}: {
    open: boolean;
    users: UserDoc[];
    usersLoading: boolean;
    cities: SubscriptionCity[];
    settings: SubscriptionSettings;
    form: ManualSubscriptionForm;
    saving: boolean;
    error: string;
    onChange: (next: ManualSubscriptionForm) => void;
    onSave: () => void;
    onClose: () => void;
}) {
    const availableCities = cities.filter((city) => city.status === "available" || city.status === "occupied");
    const selectedCity = cities.find((city) => city.id === form.cityId) || null;
    const selectedPlan = SUBSCRIPTION_PLANS.find((plan) => plan.id === form.plan);
    const amount = form.plan === "custom" ? form.amount : (selectedPlan?.amount ?? form.amount);
    const adsBudget = Math.round(amount * settings.adsShare);

    function setPlan(plan: SubscriptionPlanId) {
        const predefined = SUBSCRIPTION_PLANS.find((item) => item.id === plan);
        onChange({
            ...form,
            plan,
            amount: predefined?.amount ?? form.amount,
        });
    }

    return (
        <Modal open={open} title="Activacion manual" subtitle="Crea un ciclo activo sin Pix para una ciudad asignada." size="md" onClose={onClose}>
            <div className="space-y-4">
                <Notice tone="violet">
                    Esta accion crea una suscripcion activa para el vendedor. Si la ciudad ya esta ocupada, se suma a la bolsa compartida y se recalcula el presupuesto.
                    Con Meta sincronizado, TrackGo usa la fecha final real del conjunto de anuncios.
                </Notice>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Vendedor">
                        <select
                            value={form.userId}
                            disabled={usersLoading}
                            onChange={(event) => onChange({ ...form, userId: event.target.value })}
                            className={inputClass}
                        >
                            <option value="">{usersLoading ? "Cargando..." : "Seleccionar vendedor"}</option>
                            {users.map((user) => (
                                <option key={user.id} value={user.id}>
                                    {user.name || user.email || user.id}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Ciudad">
                        <select
                            value={form.cityId}
                            onChange={(event) => onChange({ ...form, cityId: event.target.value })}
                            className={inputClass}
                        >
                            <option value="">Seleccionar ciudad libre</option>
                            {availableCities.map((city) => (
                                <option key={city.id} value={city.id}>
                                    {[city.name, city.state, city.country].filter(Boolean).join(" - ")}{city.status === "occupied" ? " - bolsa compartida" : ""}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Plan">
                        <select value={form.plan} onChange={(event) => setPlan(event.target.value as SubscriptionPlanId)} className={inputClass}>
                            {SUBSCRIPTION_PLANS.map((plan) => (
                                <option key={plan.id} value={plan.id}>
                                    {plan.name} - {currency.format(plan.amount)}
                                </option>
                            ))}
                            <option value="custom">Personalizado</option>
                        </select>
                    </Field>
                    <Field label="Monto">
                        <input
                            type="number"
                            min={300}
                            value={form.amount}
                            disabled={form.plan !== "custom"}
                            onChange={(event) => onChange({ ...form, amount: Number(event.target.value) })}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="Duracion">
                        <input
                            type="number"
                            min={1}
                            max={30}
                            value={form.cycleDays}
                            disabled={form.syncMeta}
                            onChange={(event) => onChange({ ...form, cycleDays: Number(event.target.value) })}
                            className={inputClass}
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-2 sm:pt-5">
                        <MoneyTile label="Cobro" value={currency.format(amount)} />
                        <MoneyTile label="Inversion" value={currency.format(adsBudget)} />
                    </div>
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-[#e8e7fb] bg-[#fbfaff] p-3">
                    <input
                        type="checkbox"
                        checked={form.syncMeta}
                        onChange={(event) => onChange({ ...form, syncMeta: event.target.checked })}
                        className="mt-1 h-4 w-4 accent-[#7c3aed]"
                    />
                    <span className="min-w-0">
                        <span className="block text-[12px] font-black text-[#101936]">Activar campana Meta automaticamente</span>
                        <span className="mt-0.5 block text-[11px] font-semibold leading-snug text-[#66739a]">
                            {form.syncMeta
                                ? selectedCity?.campaignId || selectedCity?.activeCampaignId || selectedCity?.baseCampaignId
                                    ? "TrackGo configurara presupuesto diario, encendera campana y conjunto, y guardara el ciclo operativo."
                                    : "La ciudad seleccionada debe tener un ID operativo de Meta."
                                : "Solo registra la suscripcion en TrackGo; no toca la campana en Meta."}
                        </span>
                    </span>
                </label>

                {availableCities.length === 0 ? <Notice tone="red">No hay ciudades disponibles para activar manualmente.</Notice> : null}
                {error ? <Notice tone="red">{error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>Cerrar</Button>
                    <Button type="button" variant="primary" disabled={saving || !form.userId || !form.cityId} onClick={onSave}>
                        {saving ? "Activando..." : "Activar suscripcion"}
                    </Button>
                </div>
            </div>
        </Modal>
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
        <Modal open={open} title={editing ? "Editar ciudad" : "Nueva ciudad"} subtitle="Configura disponibilidad y el ID operativo." size="md" onClose={onClose}>
            <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="ID interno">
                        <input value={form.id} disabled={editing} onChange={(event) => onChange({ id: event.target.value })} placeholder="belem" className={inputClass} />
                    </Field>
                    <Field label="Ciudad">
                        <input value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="Belem" className={inputClass} />
                    </Field>
                    <Field label="Estado">
                        <input value={form.state} onChange={(event) => onChange({ state: event.target.value })} placeholder="Para" className={inputClass} />
                    </Field>
                    <Field label="Pais">
                        <input value={form.country} onChange={(event) => onChange({ country: event.target.value })} placeholder="Brasil" className={inputClass} />
                    </Field>
                    <Field label="Estado comercial">
                        <select value={form.status} onChange={(event) => onChange({ status: event.target.value as CityFormState["status"] })} className={inputClass}>
                            <option value="available">Disponible</option>
                            <option value="reserved">Reservada</option>
                            <option value="occupied">Ocupada</option>
                        </select>
                    </Field>
                    <Field label="ID operativo">
                        <div className="flex gap-2">
                            <input value={form.campaignId} onChange={(event) => onChange({ campaignId: event.target.value })} placeholder="120..." className={`${inputClass} min-w-0 flex-1 font-mono`} />
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
                    <Button type="button" variant="primary" disabled={saving} onClick={onSave}>
                        {saving ? "Guardando..." : "Guardar ciudad"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function CityDetailModal({
    city,
    subscription,
    subscriptions,
    checkout,
    canManage,
    canDelete,
    busy,
    onRelease,
    onDelete,
    onRetry,
    onHideCheckout,
    onCampaignDelivery,
    onParticipantDelivery,
    onClose,
}: {
    city: SubscriptionCity | null;
    subscription: OverviewSubscription | null;
    subscriptions: OverviewSubscription[];
    checkout: OverviewCheckout | null;
    canManage: boolean;
    canDelete: boolean;
    busy: boolean;
    onRelease: () => void;
    onDelete: () => void;
    onRetry: () => void;
    onHideCheckout: () => void;
    onCampaignDelivery: (status: "active" | "paused") => void;
    onParticipantDelivery: (subscriptionId: string, status: "active" | "paused") => void;
    onClose: () => void;
}) {
    if (!city) return null;
    const canRetry = canManage && checkout?.status === "approved" && checkout?.activationStatus === "meta_failed";
    const canHideCheckout = canRetry && checkout?.hiddenFromUser !== true;
    const canRelease = canManage && city.status !== "available";
    const canDeleteCity = canDelete && city.status === "available";
    const canToggleCampaign = canManage && city.status === "occupied";
    const campaignPaused = city.campaignDeliveryStatus === "paused";

    return (
        <Modal open title={city.name} subtitle={[city.state, city.country].filter(Boolean).join(" - ") || "Sin region"} size="md" onClose={onClose}>
            <div className="space-y-4">
                {/* Estado de la ciudad */}
                <div className="flex items-center gap-2">
                    <StatusPill status={city.status} />
                    {city.campaignDeliveryStatus ? <StatusPill status={`campaign_${city.campaignDeliveryStatus}`} /> : null}
                    {subscription ? <StatusPill status={subscription.status} /> : null}
                </div>

                {/* Vendedores y compras */}
                {subscriptions.length > 0 ? (
                    <DetailSection title={subscriptions.length > 1 ? "Compradores de la bolsa" : "Compra activa"}>
                        <div className="grid gap-2">
                            {subscriptions.map((item) => {
                                const paused = item.status === "paused";
                                const canToggleParticipant = canManage && (item.status === "active" || item.status === "paused");
                                return (
                                    <div key={item.id} className="rounded-2xl border border-[#e8e7fb] bg-white px-3 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="truncate text-[13px] font-black text-[#101936]">{item.userName}</p>
                                                    <StatusPill status={item.status} />
                                                    {item.source === "manual_admin" ? <StatusPill status="manual_admin" /> : null}
                                                </div>
                                                {item.userEmail ? <p className="mt-0.5 truncate text-[11px] font-semibold text-[#66739a]">{item.userEmail}</p> : null}
                                            </div>
                                            {canToggleParticipant ? (
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => onParticipantDelivery(item.id, paused ? "active" : "paused")}
                                                    className={[
                                                        "shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-black transition disabled:opacity-50",
                                                        paused
                                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                            : "border-amber-200 bg-amber-50 text-amber-700",
                                                    ].join(" ")}
                                                >
                                                    {paused ? "Reanudar" : "Pausar"}
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-[#66739a]">
                                            <MiniMetric label="Plan" value={item.plan || "sin plan"} />
                                            <MiniMetric label="Monto" value={currency.format(item.amount)} />
                                            <MiniMetric label="Inversion" value={currency.format(item.adsBudget)} />
                                            <MiniMetric label="Fin" value={formatDate(item.endDate)} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {city.activeParticipantsCount !== undefined && subscriptions.length > 1 ? (
                            <div className="mt-2 rounded-2xl border border-violet-100 bg-[#f8f7ff] px-3 py-2 text-[11px] font-bold text-[#6d28d9]">
                                {city.activeParticipantsCount} activo{city.activeParticipantsCount === 1 ? "" : "s"} · presupuesto diario {currency.format(city.sharedPoolDailyBudget || 0)}
                            </div>
                        ) : null}
                    </DetailSection>
                ) : (
                    <Notice tone="violet">Sin suscripcion activa registrada para esta ciudad.</Notice>
                )}

                {/* Pago */}
                {checkout ? (
                    <DetailSection title="Pago">
                        <DetailRow label="Estado del pago" value={<StatusPill status={checkout.status} />} />
                        <DetailRow label="Activacion" value={<StatusPill status={checkout.activationStatus} />} />
                        {checkout.paymentId ? <DetailRow label="ID pago" value={<span className="font-mono text-[11px]">{checkout.paymentId}</span>} /> : null}
                        {checkout.paymentApprovedAt ? <DetailRow label="Aprobado" value={dateTime.format(new Date(checkout.paymentApprovedAt))} /> : null}
                        {checkout.createdAt ? <DetailRow label="Creado" value={dateTime.format(new Date(checkout.createdAt))} /> : null}
                        {checkout.failureReason ? (
                            <div className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2">
                                <p className="text-[10px] font-black uppercase tracking-[0.1em] text-red-700">Error</p>
                                <p className="mt-1 text-[11px] font-semibold text-red-700">{humanizeError(checkout.failureReason)}</p>
                            </div>
                        ) : null}
                        {checkout.ticketUrl ? (
                            <a
                                href={checkout.ticketUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 block rounded-xl border border-[#ded8ff] bg-[#f8f7ff] px-3 py-2 text-[11px] font-black text-[#6d28d9]"
                            >
                                Ver comprobante MercadoPago
                            </a>
                        ) : null}
                    </DetailSection>
                ) : null}

                {/* Acciones */}
                {(canRetry || canHideCheckout || canToggleCampaign || canRelease || canDeleteCity) ? (
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                        {canRetry ? (
                            <Button type="button" variant="secondary" disabled={busy} onClick={onRetry}>
                                <AppIcon name="refresh" size="sm" plain className="h-4 w-4 text-current" />
                                {busy ? "Reintentando..." : "Reintentar activacion"}
                            </Button>
                        ) : null}
                        {canHideCheckout ? (
                            <Button type="button" variant="ghost" disabled={busy} onClick={onHideCheckout}>
                                Ocultar al vendedor
                            </Button>
                        ) : null}
                        {canToggleCampaign ? (
                            <Button type="button" variant="secondary" disabled={busy} onClick={() => onCampaignDelivery(campaignPaused ? "active" : "paused")}>
                                <AppIcon name={campaignPaused ? "play" : "pause"} size="sm" plain className="h-4 w-4 text-current" />
                                {campaignPaused ? "Reanudar campana" : "Pausar campana"}
                            </Button>
                        ) : null}
                        {canRelease ? (
                            <Button type="button" variant="danger" disabled={busy} onClick={onRelease}>
                                <AppIcon name="unlock" size="sm" plain className="h-4 w-4 text-current" />
                                {busy ? "Liberando..." : "Liberar ciudad"}
                            </Button>
                        ) : null}
                        {canDeleteCity ? (
                            <Button type="button" variant="danger" disabled={busy} onClick={onDelete}>
                                <AppIcon name="trash" size="sm" plain className="h-4 w-4 text-current" />
                                {busy ? "Eliminando..." : "Eliminar ciudad"}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="rounded-2xl border border-[#eef1f5] bg-[#faf9ff] p-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">{title}</p>
            <div className="space-y-1.5">{children}</div>
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold text-[#66739a]">{label}</span>
            <span className="text-right text-[12px] font-black text-[#101936]">{value}</span>
        </div>
    );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="rounded-xl bg-[#fbfaff] px-2.5 py-2">
            <span className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#8a8fa3]">{label}</span>
            <span className="mt-0.5 block truncate text-[12px] font-black text-[#101936]">{value}</span>
        </div>
    );
}

function StatusPill({ status }: { status: string }) {
    const normalized = status || "unknown";
    const classes =
        normalized === "available" || normalized === "active" || normalized === "approved"
            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
            : normalized === "paused" || normalized === "campaign_paused"
              ? "bg-amber-50 text-amber-700 ring-amber-100"
            : normalized === "campaign_active"
              ? "bg-blue-50 text-blue-700 ring-blue-100"
            : normalized === "occupied" || normalized === "reserved" || normalized === "processing" || normalized === "waiting_payment"
              ? "bg-amber-50 text-amber-700 ring-amber-100"
              : normalized.includes("failed") || normalized === "meta_failed"
                ? "bg-red-50 text-red-700 ring-red-100"
                : normalized === "city_released" || normalized === "cancelled"
                  ? "bg-slate-50 text-slate-700 ring-slate-100"
                : "bg-slate-50 text-slate-700 ring-slate-100";
    return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ring-1 ${classes}`}>{labelStatus(normalized)}</span>;
}

function StatusBadge({ children }: { children: ReactNode }) {
    return <span className="rounded-full bg-[#f4f0ff] px-3 py-1 text-[11px] font-black text-[#6d28d9]">{children}</span>;
}

function MoneyTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl bg-[#f8f7ff] p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#66739a]">{label}</p>
            <p className="mt-1 text-[20px] font-black tracking-[-0.04em] text-[#101936]">{value}</p>
        </div>
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
    const cls =
        tone === "red"
            ? "border-red-100 bg-red-50 text-red-700"
            : tone === "green"
              ? "border-emerald-100 bg-emerald-50 text-emerald-800"
              : "border-[#ded8ff] bg-[#fbfaff] text-[#52607a]";
    return <div className={`rounded-2xl border p-3 text-[12px] font-semibold leading-snug ${cls}`}>{children}</div>;
}

function EmptyInline({ text }: { text: string }) {
    return <div className="rounded-2xl border border-dashed border-[#ded8ff] bg-[#fbfaff] p-4 text-center text-[12px] font-bold text-[#66739a]">{text}</div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-3xl border border-[#e8e7fb] bg-white p-6 text-center">
            <p className="text-[16px] font-black text-[#101936]">{title}</p>
            <p className="mt-1 text-[13px] font-semibold text-[#66739a]">{body}</p>
        </div>
    );
}

function formatDate(value?: number | null) {
    return value ? dateTime.format(new Date(value)) : "sin fecha";
}

function formatCountdown(endDate?: number | null): string {
    if (!endDate) return "";
    const msLeft = endDate - Date.now();
    if (msLeft <= 0) return "Expirado";
    const totalHours = Math.floor(msLeft / (1000 * 60 * 60));
    if (totalHours < 1) return "menos de 1h";
    if (totalHours < 24) return `en ${totalHours}h`;
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours > 0 ? `en ${days}d ${hours}h` : `en ${days}d`;
}

function labelStatus(status: string) {
    const labels: Record<string, string> = {
        available: "Disponible",
        reserved: "Reservada",
        occupied: "Ocupada",
        waiting_payment: "Esperando",
        processing: "Procesando",
        active: "Activa",
        paused: "Pausada",
        manual_admin: "Manual",
        campaign_active: "Campana activa",
        campaign_paused: "Campana pausada",
        approved: "Aprobado",
        meta_failed: "Error",
        failed: "Error",
        expired: "Expirada",
        cancelled: "Cancelada",
        city_released: "Liberada",
    };
    return labels[status] || status;
}

function humanizeError(message: string) {
    if (!message) return "No se pudo completar la operacion.";
    if (message.includes("WhatsApp")) return "La configuracion requiere revisar el numero vinculado.";
    if (message.includes("Invalid parameter")) {
        return message
            .split("|")
            .map((part) => part.trim())
            .filter(Boolean)
            .slice(1, 3)
            .join(" - ") || "El proveedor rechazo algun parametro.";
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
