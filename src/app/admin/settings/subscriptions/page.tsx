"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/features/auth/AuthProvider";
import { usePermissions } from "@/features/auth/usePermissions";
import type { PixCheckoutResponse, SubscriptionCity, SubscriptionPlanId } from "@/types/subscriptions";
import { estimateLeadRange, SUBSCRIPTION_PLANS } from "@/lib/subscriptionPlans";

type UiPlan = {
    id: SubscriptionPlanId;
    name: string;
    price: number;
    campaignBudget: number;
    estimatedLeads: string;
    tone: "blue" | "purple" | "green";
    badge?: string;
    description: string;
    features: string[];
};

const PLANS: UiPlan[] = [
    {
        id: "base",
        name: "Base",
        price: 300,
        campaignBudget: 150,
        estimatedLeads: "10-35",
        tone: "blue",
        description: "Para validar una ciudad o una zona sin invertir demasiado.",
        features: [
            "Campana de 5 dias operativos",
            "Acceso a incompletos con negocio",
            "Reporte semanal por usuario",
        ],
    },
    {
        id: "crecimiento",
        name: "Crecimiento",
        price: 400,
        campaignBudget: 200,
        estimatedLeads: "20-50",
        tone: "purple",
        badge: "Recomendado",
        description: "El punto mas equilibrado entre volumen, riesgo y margen.",
        features: [
            "Mayor presupuesto para Meta",
            "Auto-asignacion por cobertura",
            "Prioridad de optimizacion semanal",
        ],
    },
    {
        id: "dominio",
        name: "Dominio",
        price: 600,
        campaignBudget: 300,
        estimatedLeads: "35-80",
        tone: "green",
        description: "Para usuarios con cobertura activa y capacidad de atender mas demanda.",
        features: [
            "Presupuesto ampliado",
            "Lectura de conversion por zona",
            "Base incompleta como respaldo comercial",
        ],
    },
];

const cycleItems = [
    {
        title: "Ciclo TrackGo",
        value: "5 dias",
        detail: "Lunes a sabado de madrugada, con cierre operativo al terminar viernes.",
        icon: "clock" as const,
        tone: "purple" as const,
    },
    {
        title: "Distribucion",
        value: "50 / 50",
        detail: "Mitad para anuncios Meta, mitad margen operativo TrackGo.",
        icon: "wallet" as const,
        tone: "green" as const,
    },
    {
        title: "Activacion",
        value: "Pix -> Meta",
        detail: "Pago aprobado, ciudad reservada y campana activada desde backend.",
        icon: "play" as const,
        tone: "blue" as const,
    },
];

const currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
});

type CityFormState = {
    id: string;
    name: string;
    state: string;
    country: string;
    status: "available" | "reserved" | "occupied";
    baseCampaignId: string;
};

const emptyCityForm: CityFormState = {
    id: "",
    name: "",
    state: "",
    country: "Brasil",
    status: "available",
    baseCampaignId: "",
};

export default function SubscriptionsPage() {
    const permissions = usePermissions();
    const { isSuperAdmin } = useAuth();
    const [customAmount, setCustomAmount] = useState("350");
    const [selectedPlan, setSelectedPlan] = useState<UiPlan | null>(null);
    const [customModalOpen, setCustomModalOpen] = useState(false);
    const [selectedCityId, setSelectedCityId] = useState("");
    const [cities, setCities] = useState<SubscriptionCity[]>([]);
    const [loadingCities, setLoadingCities] = useState(true);
    const [citiesError, setCitiesError] = useState("");
    const [pixResult, setPixResult] = useState<PixCheckoutResponse | null>(null);
    const [checkoutError, setCheckoutError] = useState("");
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [cityModalOpen, setCityModalOpen] = useState(false);
    const [cityForm, setCityForm] = useState<CityFormState>(emptyCityForm);
    const [citySaving, setCitySaving] = useState(false);
    const [citySaveError, setCitySaveError] = useState("");
    const [editingCityId, setEditingCityId] = useState<string | null>(null);

    const customSimulation = useMemo(() => {
        const amount = Math.max(0, Number(customAmount.replace(",", ".")) || 0);
        const campaignBudget = Math.round(amount * 0.5);
        const trackGoMargin = amount - campaignBudget;
        return {
            amount,
            campaignBudget,
            trackGoMargin,
            estimatedLeads: estimateLeadRange(campaignBudget),
        };
    }, [customAmount]);

    const canEdit = permissions.accountingInvestmentEdit;
    const canManageCities = isSuperAdmin;
    const selectedCity = cities.find((city) => city.id === selectedCityId) || null;

    const loadCities = useCallback(async () => {
        setLoadingCities(true);
        setCitiesError("");
        try {
            const user = await waitForAuthUser();
            const token = await user.getIdToken();
            const response = await fetch("/api/subscriptions/cities", {
                cache: "no-store",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.message || "No se pudieron cargar las ciudades.");
            }
            setCities(data.cities || []);
        } catch (error) {
            setCitiesError(error instanceof Error ? error.message : "No se pudieron cargar las ciudades.");
        } finally {
            setLoadingCities(false);
        }
    }, []);

    useEffect(() => {
        loadCities();
    }, [loadCities]);

    useEffect(() => {
        if (!selectedCityId && cities.length) {
            const firstAvailable = cities.find((city) => city.status === "available");
            setSelectedCityId(firstAvailable?.id || cities[0].id);
        }
    }, [cities, selectedCityId]);

    const resetCheckout = () => {
        setPixResult(null);
        setCheckoutError("");
        setCopied(false);
    };

    const createCheckout = async ({
        plan,
        amount,
    }: {
        plan: SubscriptionPlanId;
        amount?: number;
    }) => {
        if (!auth.currentUser) {
            setCheckoutError("Debes iniciar sesion para generar Pix.");
            return;
        }

        if (!selectedCity) {
            setCheckoutError("Selecciona una ciudad.");
            return;
        }

        if (selectedCity.status !== "available") {
            setCheckoutError("Esta ciudad no esta disponible para venta.");
            return;
        }

        setCheckoutLoading(true);
        setCheckoutError("");
        setPixResult(null);

        try {
            const token = await auth.currentUser.getIdToken();
            const response = await fetch("/api/subscriptions/create-pix", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    userId: auth.currentUser.uid,
                    email: auth.currentUser.email,
                    cityId: selectedCity.id,
                    plan,
                    amount,
                }),
            });

            const data = await response.json();
            if (!response.ok || !data.ok) {
                throw new Error(data.message || "No se pudo crear el Pix.");
            }

            setPixResult(data.pix);
            await loadCities();
        } catch (error) {
            setCheckoutError(error instanceof Error ? error.message : "No se pudo crear el Pix.");
        } finally {
            setCheckoutLoading(false);
        }
    };

    const copyPix = async () => {
        if (!pixResult?.qrCode) return;
        await navigator.clipboard.writeText(pixResult.qrCode);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
    };

    const openCreateCity = () => {
        setEditingCityId(null);
        setCityForm(emptyCityForm);
        setCitySaveError("");
        setCityModalOpen(true);
    };

    const openEditCity = (city: SubscriptionCity) => {
        setEditingCityId(city.id);
        setCityForm({
            id: city.id,
            name: city.name,
            state: city.state || "",
            country: city.country || "Brasil",
            status: city.status,
            baseCampaignId: city.baseCampaignId || "",
        });
        setCitySaveError("");
        setCityModalOpen(true);
    };

    const saveCity = async () => {
        try {
            const user = await waitForAuthUser();
            const token = await user.getIdToken();
            setCitySaving(true);
            setCitySaveError("");

            const response = await fetch("/api/subscriptions/cities", {
                method: editingCityId ? "PATCH" : "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(cityForm),
            });
            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.message || "No se pudo guardar la ciudad.");
            }

            setCityModalOpen(false);
            setEditingCityId(null);
            setCityForm(emptyCityForm);
            await loadCities();
        } catch (error) {
            setCitySaveError(error instanceof Error ? error.message : "No se pudo guardar la ciudad.");
        } finally {
            setCitySaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader
                title="Suscripciones Pix"
                subtitle="Prueba controlada para reservar ciudad, cobrar por Pix y activar campana Meta despues del pago."
                icon={<AppIcon name="wallet" tone="purple" plain className="text-white" />}
                actions={
                    <div className="flex items-center gap-2">
                        {canManageCities ? (
                            <Button variant="primary" className="gap-2" type="button" onClick={openCreateCity}>
                                <AppIcon name="plus" size="sm" plain className="h-4 w-4 text-current" />
                                Ciudad
                            </Button>
                        ) : null}
                        <Button variant="secondary" className="gap-2" type="button" onClick={loadCities}>
                            <AppIcon name="refresh" size="sm" plain className="h-4 w-4 text-current" />
                            Ciudades
                        </Button>
                    </div>
                }
            />

            <section className="grid gap-3 lg:grid-cols-3">
                {cycleItems.map((item) => (
                    <Card key={item.title} className="overflow-hidden">
                        <div className="flex items-start gap-3 p-4">
                            <AppIcon name={item.icon} tone={item.tone} size="md" />
                            <div className="min-w-0">
                                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#66739a]">
                                    {item.title}
                                </p>
                                <p className="mt-1 text-[22px] font-black tracking-[-0.04em] text-[#101936]">
                                    {item.value}
                                </p>
                                <p className="mt-1 text-[12px] font-semibold leading-snug text-[#66739a]">
                                    {item.detail}
                                </p>
                            </div>
                        </div>
                    </Card>
                ))}
            </section>

            <section className="grid gap-3 xl:grid-cols-[360px_1fr]">
                <Card>
                    <CardHeader
                        title="Selecciona ciudad"
                        subtitle="Regla activa: una ciudad solo puede tener un usuario activo."
                    />
                    <CardContent className="space-y-3">
                        {loadingCities ? (
                            <p className="rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-3 text-[12px] font-bold text-[#66739a]">
                                Cargando ciudades...
                            </p>
                        ) : null}

                        {citiesError ? (
                            <p className="rounded-2xl border border-red-100 bg-red-50 p-3 text-[12px] font-bold text-red-700">
                                {citiesError}
                            </p>
                        ) : null}

                        {!loadingCities && cities.length === 0 ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] font-semibold leading-snug text-amber-800">
                                No hay ciudades configuradas. Crea documentos en <span className="font-mono">cities</span> con nombre,
                                estado <span className="font-mono">available</span> y <span className="font-mono">baseCampaignId</span>.
                            </div>
                        ) : null}

                        <div className="grid gap-2">
                            {cities.map((city) => (
                                <div
                                    key={city.id}
                                    className={[
                                        "flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition",
                                        selectedCityId === city.id
                                            ? "border-[#7c3aed] bg-[#f7f3ff] shadow-[0_14px_28px_rgba(91,33,255,0.12)]"
                                            : "border-[#eef1f5] bg-white hover:border-[#ded8ff]",
                                        city.status !== "available" ? "opacity-80" : "",
                                    ].join(" ")}
                                >
                                    <button
                                        type="button"
                                        disabled={city.status !== "available"}
                                        onClick={() => setSelectedCityId(city.id)}
                                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                                    >
                                        <span className="block text-[13px] font-black text-[#101936]">
                                            {city.name}
                                        </span>
                                        <span className="mt-0.5 block text-[11px] font-semibold text-[#66739a]">
                                            {[city.state, city.country].filter(Boolean).join(" · ") || "Sin region"}
                                        </span>
                                        <span className="mt-1 block truncate font-mono text-[10px] font-bold text-[#98a2b3]">
                                            {city.baseCampaignId ? `Meta ${city.baseCampaignId}` : "Sin campana base"}
                                        </span>
                                    </button>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <CityStatusPill city={city} />
                                        {canManageCities ? (
                                            <button
                                                type="button"
                                                aria-label={`Editar ${city.name}`}
                                                onClick={() => openEditCity(city)}
                                                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#ded8ff] bg-white text-[#6d28d9] shadow-sm"
                                            >
                                                <AppIcon name="edit" size="sm" plain className="h-4 w-4 text-current" />
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader
                        title="Planes semanales"
                        subtitle="El Pix real se genera contra la ciudad seleccionada y queda pendiente hasta webhook."
                    />
                    <CardContent className="grid gap-3 lg:grid-cols-3">
                        {PLANS.map((plan) => (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                disabled={!canEdit || !selectedCity || selectedCity.status !== "available"}
                                onSelect={() => {
                                    resetCheckout();
                                    setSelectedPlan(plan);
                                }}
                            />
                        ))}
                    </CardContent>
                </Card>
            </section>

            <section className="grid gap-3 xl:grid-cols-[1fr_360px]">
                <Card>
                    <CardHeader
                        title="Flujo de activacion"
                        subtitle="El backend valida monto, ciudad y pago antes de tocar Meta."
                    />
                    <CardContent>
                        <div className="grid gap-3 md:grid-cols-2">
                            {[
                                ["1", "Reserva temporal", "Al generar Pix la ciudad queda reservada 30 minutos para evitar doble venta."],
                                ["2", "Pago aprobado", "Mercado Pago llama al webhook y TrackGo valida monto exacto e idempotencia."],
                                ["3", "Campana Meta", "Se duplica la campana base, se configura lifetime budget en ad sets y se activa."],
                                ["4", "Suscripcion activa", "La ciudad queda ocupada y se guarda la suscripcion con fechas del ciclo."],
                            ].map(([step, title, body]) => (
                                <div key={step} className="flex gap-3 rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-3">
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#f3f0ff] text-[12px] font-black text-[#6d28d9] ring-1 ring-[#ded8ff]">
                                        {step}
                                    </span>
                                    <div>
                                        <p className="text-[13px] font-black text-[#101936]">{title}</p>
                                        <p className="mt-0.5 text-[12px] font-semibold leading-snug text-[#66739a]">{body}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="overflow-hidden">
                    <CardHeader
                        title="Presupuesto personalizado"
                        subtitle="Calcula volumen aproximado y genera Pix con valor libre."
                    />
                    <CardContent className="space-y-4">
                        <label className="block">
                            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-[#66739a]">
                                Valor de suscripcion
                            </span>
                            <div className="mt-2 flex items-center rounded-2xl border border-[#ded8ff] bg-[#fbfaff] px-3 py-2.5 shadow-inner">
                                <span className="text-[13px] font-black text-[#7c3aed]">R$</span>
                                <input
                                    value={customAmount}
                                    onChange={(e) => setCustomAmount(e.target.value)}
                                    inputMode="decimal"
                                    className="ml-2 w-full bg-transparent text-[24px] font-black tracking-[-0.04em] text-[#101936] outline-none"
                                    placeholder="350"
                                />
                            </div>
                        </label>

                        <div className="grid grid-cols-2 gap-2">
                            <MoneyTile label="Anuncios Meta" value={customSimulation.campaignBudget} tone="green" />
                            <MoneyTile label="TrackGo" value={customSimulation.trackGoMargin} tone="purple" />
                        </div>

                        <div className="rounded-2xl border border-[#e8e7fb] bg-white p-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#66739a]">
                                Estimacion
                            </p>
                            <p className="mt-1 text-[28px] font-black tracking-[-0.05em] text-[#101936]">
                                {customSimulation.estimatedLeads} leads
                            </p>
                            <p className="mt-1 text-[12px] font-semibold leading-snug text-[#66739a]">
                                Puede variar por ciudad, competencia, aceptacion de Meta, calidad del publico y hora de entrega.
                            </p>
                        </div>

                        <Button
                            type="button"
                            variant="primary"
                            className="w-full"
                            disabled={!canEdit || customSimulation.amount < 100 || !selectedCity || selectedCity.status !== "available"}
                            onClick={() => {
                                resetCheckout();
                                setCustomModalOpen(true);
                            }}
                        >
                            Generar Pix personalizado
                        </Button>
                    </CardContent>
                </Card>
            </section>

            <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                <Card>
                    <CardHeader
                        title="Planes configurados"
                        subtitle="Referencia compartida entre frontend y backend."
                    />
                    <CardContent className="space-y-2">
                        {SUBSCRIPTION_PLANS.map((plan) => (
                            <div key={plan.id} className="flex items-center justify-between rounded-2xl border border-[#eef1f5] bg-white p-3">
                                <div>
                                    <p className="text-[13px] font-black text-[#101936]">{plan.name}</p>
                                    <p className="text-[11px] font-semibold text-[#66739a]">{plan.description}</p>
                                </div>
                                <span className="text-[13px] font-black text-[#6d28d9]">{currency.format(plan.amount)}</span>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader
                        title="Pendiente antes de produccion"
                        subtitle="No es bloqueo para probar, pero si para cobrar con tranquilidad."
                    />
                    <CardContent>
                        <div className="grid gap-2 md:grid-cols-2">
                            <StrategyNote title="Webhook publico" body="En Vercel configura MERCADOPAGO_WEBHOOK_URL con https://trackgo.co/api/webhook/mercadopago." />
                            <StrategyNote title="Credenciales" body="Las llaves deben vivir en Vercel Environment Variables, nunca en el repo." />
                            <StrategyNote title="Reembolso" body="Define flujo manual si alguien paga y Meta falla o la ciudad se ocupó por carrera." />
                            <StrategyNote title="Meta base" body="Cada ciudad necesita baseCampaignId apuntando a una campana plantilla que nunca se modifica." />
                        </div>
                    </CardContent>
                </Card>
            </section>

            <CheckoutModal
                open={Boolean(selectedPlan)}
                title={selectedPlan ? `Plan ${selectedPlan.name}` : ""}
                amount={selectedPlan?.price ?? 0}
                campaignBudget={selectedPlan?.campaignBudget ?? 0}
                estimatedLeads={selectedPlan?.estimatedLeads ?? ""}
                city={selectedCity}
                canEdit={canEdit}
                loading={checkoutLoading}
                error={checkoutError}
                pixResult={pixResult}
                copied={copied}
                onCopy={copyPix}
                onCreate={() => selectedPlan && createCheckout({ plan: selectedPlan.id })}
                onClose={() => {
                    setSelectedPlan(null);
                    resetCheckout();
                }}
            />
            <CheckoutModal
                open={customModalOpen}
                title="Pix personalizado"
                amount={customSimulation.amount}
                campaignBudget={customSimulation.campaignBudget}
                estimatedLeads={customSimulation.estimatedLeads}
                city={selectedCity}
                canEdit={canEdit}
                loading={checkoutLoading}
                error={checkoutError}
                pixResult={pixResult}
                copied={copied}
                onCopy={copyPix}
                onCreate={() => createCheckout({ plan: "custom", amount: customSimulation.amount })}
                onClose={() => {
                    setCustomModalOpen(false);
                    resetCheckout();
                }}
            />
            <CityConfigModal
                open={cityModalOpen}
                form={cityForm}
                editing={Boolean(editingCityId)}
                saving={citySaving}
                error={citySaveError}
                onChange={(patch) => setCityForm((current) => ({ ...current, ...patch }))}
                onSave={saveCity}
                onClose={() => {
                    setCityModalOpen(false);
                    setEditingCityId(null);
                    setCitySaveError("");
                }}
            />
        </div>
    );
}

function waitForAuthUser() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);

    return new Promise<User>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            unsubscribe();
            reject(new Error("No se pudo confirmar la sesion activa."));
        }, 8000);

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!user) return;
            window.clearTimeout(timeout);
            unsubscribe();
            resolve(user);
        });
    });
}

function CityStatusPill({ city }: { city: SubscriptionCity }) {
    const styles = {
        available: "bg-emerald-50 text-emerald-700 ring-emerald-100",
        reserved: "bg-amber-50 text-amber-700 ring-amber-100",
        occupied: "bg-rose-50 text-rose-700 ring-rose-100",
    };
    const labels = {
        available: "Disponible",
        reserved: "Reservada",
        occupied: "Ocupada",
    };

    return (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ring-1 ${styles[city.status]}`}>
            {labels[city.status]}
        </span>
    );
}

function PlanCard({
    plan,
    disabled,
    onSelect,
}: {
    plan: UiPlan;
    disabled: boolean;
    onSelect: () => void;
}) {
    return (
        <article className="relative flex min-h-[340px] flex-col rounded-3xl border border-[#e8e7fb] bg-[linear-gradient(180deg,#ffffff_0%,#fbfaff_100%)] p-4 shadow-[0_16px_34px_rgba(91,33,255,0.07)]">
            {plan.badge ? (
                <span className="absolute right-3 top-3 rounded-full bg-[#f3f0ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#6d28d9] ring-1 ring-[#ded8ff]">
                    {plan.badge}
                </span>
            ) : null}

            <AppIcon name="wallet" tone={plan.tone} size="lg" />
            <div className="mt-4">
                <h2 className="text-[20px] font-black tracking-[-0.04em] text-[#101936]">{plan.name}</h2>
                <p className="mt-1 min-h-10 text-[12px] font-semibold leading-snug text-[#66739a]">{plan.description}</p>
            </div>

            <div className="mt-4 rounded-2xl border border-[#eef1f5] bg-white p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#66739a]">
                    Suscripcion
                </p>
                <p className="mt-1 text-[30px] font-black tracking-[-0.06em] text-[#101936]">
                    {currency.format(plan.price)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold">
                    <span className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-700">
                        {currency.format(plan.campaignBudget)} Meta
                    </span>
                    <span className="rounded-xl bg-violet-50 px-2 py-2 text-violet-700">
                        {plan.estimatedLeads} leads
                    </span>
                </div>
            </div>

            <ul className="mt-4 space-y-2">
                {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-[12px] font-semibold leading-snug text-[#52607a]">
                        <AppIcon name="check" tone="green" size="sm" className="h-5 w-5 rounded-lg" />
                        <span>{feature}</span>
                    </li>
                ))}
            </ul>

            <Button type="button" variant="primary" className="mt-auto w-full" disabled={disabled} onClick={onSelect}>
                Generar Pix
            </Button>
        </article>
    );
}

function MoneyTile({ label, value, tone }: { label: string; value: number; tone: "green" | "purple" }) {
    return (
        <div className={tone === "green" ? "rounded-2xl bg-emerald-50 p-3" : "rounded-2xl bg-violet-50 p-3"}>
            <p className={tone === "green" ? "text-[10px] font-black uppercase tracking-[0.1em] text-emerald-700" : "text-[10px] font-black uppercase tracking-[0.1em] text-violet-700"}>
                {label}
            </p>
            <p className="mt-1 text-[18px] font-black tracking-[-0.04em] text-[#101936]">{currency.format(value)}</p>
        </div>
    );
}

function StrategyNote({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-3">
            <p className="text-[13px] font-black text-[#101936]">{title}</p>
            <p className="mt-1 text-[12px] font-semibold leading-snug text-[#66739a]">{body}</p>
        </div>
    );
}

function CheckoutModal({
    open,
    title,
    amount,
    campaignBudget,
    estimatedLeads,
    city,
    canEdit,
    loading,
    error,
    pixResult,
    copied,
    onCopy,
    onCreate,
    onClose,
}: {
    open: boolean;
    title: string;
    amount: number;
    campaignBudget: number;
    estimatedLeads: string;
    city: SubscriptionCity | null;
    canEdit: boolean;
    loading: boolean;
    error: string;
    pixResult: PixCheckoutResponse | null;
    copied: boolean;
    onCopy: () => void;
    onCreate: () => void;
    onClose: () => void;
}) {
    const operation = Math.max(0, amount - campaignBudget);

    return (
        <Modal
            open={open}
            title={title}
            subtitle={city ? `${city.name} · Pix real via Mercado Pago` : "Selecciona una ciudad disponible"}
            size="md"
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-[190px_1fr]">
                <div className="rounded-3xl border border-[#ded8ff] bg-[linear-gradient(135deg,#f8f7ff,#ffffff)] p-4">
                    {pixResult?.qrCodeBase64 ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={`data:image/png;base64,${pixResult.qrCodeBase64}`}
                            alt="QR Pix"
                            className="aspect-square w-full rounded-2xl bg-white object-contain p-2 shadow-inner"
                        />
                    ) : (
                        <div className="grid aspect-square grid-cols-5 gap-1 rounded-2xl bg-white p-3 shadow-inner">
                            {Array.from({ length: 25 }).map((_, index) => (
                                <span
                                    key={index}
                                    className={[
                                        "rounded-[4px]",
                                        index % 2 === 0 || index % 7 === 0 ? "bg-[#6d28d9]" : "bg-[#ede9fe]",
                                    ].join(" ")}
                                />
                            ))}
                        </div>
                    )}
                    <p className="mt-3 text-center text-[10px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">
                        {pixResult ? "Pix listo" : "QR pendiente"}
                    </p>
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                        <MoneyTile label="Total Pix" value={amount} tone="purple" />
                        <MoneyTile label="Campana" value={campaignBudget} tone="green" />
                    </div>
                    <div className="rounded-2xl border border-[#eef1f5] bg-[#fbfaff] p-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#66739a]">
                            Entrega esperada
                        </p>
                        <p className="mt-1 text-[22px] font-black tracking-[-0.04em] text-[#101936]">
                            {estimatedLeads} leads
                        </p>
                        <p className="mt-1 text-[12px] font-semibold leading-snug text-[#66739a]">
                            Operacion TrackGo: {currency.format(operation)}. El webhook valida el pago antes de activar Meta.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-dashed border-[#c7bfff] bg-[#f8f7ff] p-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#6d28d9]">
                            Pix copia y pega
                        </p>
                        <p className="mt-2 max-h-28 overflow-y-auto break-all rounded-xl bg-white p-2 font-mono text-[10px] font-bold text-[#52607a]">
                            {pixResult?.qrCode || "Genera el checkout para recibir el codigo real de Mercado Pago."}
                        </p>
                        {pixResult?.qrCode ? (
                            <Button type="button" variant="secondary" className="mt-2 w-full" onClick={onCopy}>
                                {copied ? "Copiado" : "Copiar Pix"}
                            </Button>
                        ) : null}
                    </div>
                    {pixResult?.ticketUrl ? (
                        <a
                            href={pixResult.ticketUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-2xl border border-[#ded8ff] bg-white p-3 text-center text-[12px] font-black text-[#6d28d9]"
                        >
                            Abrir checkout Mercado Pago
                        </a>
                    ) : null}
                </div>
            </div>

            {error ? (
                <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-3 text-[12px] font-semibold leading-snug text-red-700">
                    {error}
                </div>
            ) : null}

            {pixResult ? (
                <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-[12px] font-semibold leading-snug text-emerald-800">
                    Pix creado. Cuando Mercado Pago confirme el pago, el webhook intentara ocupar la ciudad y activar la campana.
                </div>
            ) : (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] font-semibold leading-snug text-amber-800">
                    La ciudad se reservara por 30 minutos al crear el Pix. Si el pago no se aprueba, podras liberarla manualmente o esperar expiracion.
                </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                    Cerrar
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    disabled={!canEdit || loading || !city || city.status !== "available" || Boolean(pixResult)}
                    onClick={onCreate}
                >
                    {loading ? "Generando..." : "Crear Pix"}
                </Button>
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
    onChange,
    onSave,
    onClose,
}: {
    open: boolean;
    form: CityFormState;
    editing: boolean;
    saving: boolean;
    error: string;
    onChange: (patch: Partial<CityFormState>) => void;
    onSave: () => void;
    onClose: () => void;
}) {
    return (
        <Modal
            open={open}
            title={editing ? "Editar ciudad" : "Nueva ciudad"}
            subtitle="Configura la ciudad y la campana plantilla que TrackGo duplicara despues del Pix."
            size="md"
            onClose={onClose}
        >
            <div className="space-y-4">
                <div className="rounded-2xl border border-[#ded8ff] bg-[#fbfaff] p-3 text-[12px] font-semibold leading-snug text-[#52607a]">
                    <span className="font-black text-[#101936]">baseCampaignId</span> es el ID de la campana original en Meta Ads.
                    TrackGo no modifica esa campana: solo la copia, configura presupuesto y activa la copia.
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="ID interno">
                        <input
                            value={form.id}
                            disabled={editing}
                            onChange={(e) => onChange({ id: e.target.value })}
                            placeholder="manaus"
                            className="h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold text-[#101936] outline-none disabled:bg-[#f8f7ff] disabled:text-[#98a2b3]"
                        />
                    </Field>
                    <Field label="Ciudad">
                        <input
                            value={form.name}
                            onChange={(e) => onChange({ name: e.target.value })}
                            placeholder="Manaus"
                            className="h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold text-[#101936] outline-none"
                        />
                    </Field>
                    <Field label="Estado">
                        <input
                            value={form.state}
                            onChange={(e) => onChange({ state: e.target.value })}
                            placeholder="Amazonas"
                            className="h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold text-[#101936] outline-none"
                        />
                    </Field>
                    <Field label="Pais">
                        <input
                            value={form.country}
                            onChange={(e) => onChange({ country: e.target.value })}
                            placeholder="Brasil"
                            className="h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold text-[#101936] outline-none"
                        />
                    </Field>
                    <Field label="Estado comercial">
                        <select
                            value={form.status}
                            onChange={(e) => onChange({ status: e.target.value as CityFormState["status"] })}
                            className="h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 text-[13px] font-bold text-[#101936] outline-none"
                        >
                            <option value="available">Disponible</option>
                            <option value="reserved">Reservada</option>
                            <option value="occupied">Ocupada</option>
                        </select>
                    </Field>
                    <Field label="ID campana base Meta">
                        <input
                            value={form.baseCampaignId}
                            onChange={(e) => onChange({ baseCampaignId: e.target.value })}
                            placeholder="120215934567890123"
                            className="h-11 w-full rounded-2xl border border-[#e8e7fb] bg-white px-3 font-mono text-[13px] font-bold text-[#101936] outline-none"
                        />
                    </Field>
                </div>

                {error ? (
                    <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-[12px] font-semibold text-red-700">
                        {error}
                    </div>
                ) : null}

                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose}>
                        Cerrar
                    </Button>
                    <Button type="button" variant="primary" disabled={saving} onClick={onSave}>
                        {saving ? "Guardando..." : "Guardar ciudad"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-[#66739a]">
                {label}
            </span>
            {children}
        </label>
    );
}
