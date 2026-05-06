"use client";

import { useMemo, useState } from "react";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { usePermissions } from "@/features/auth/usePermissions";

type SubscriptionPlan = {
    id: "starter" | "growth" | "scale";
    name: string;
    price: number;
    campaignBudget: number;
    estimatedLeads: string;
    tone: "blue" | "purple" | "green";
    badge?: string;
    description: string;
    features: string[];
};

const PLANS: SubscriptionPlan[] = [
    {
        id: "starter",
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
        id: "growth",
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
        id: "scale",
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
        value: "Lun - Sab",
        detail: "5 dias completos, cerrando el viernes en la madrugada.",
        icon: "clock" as const,
        tone: "purple" as const,
    },
    {
        title: "Distribucion",
        value: "50 / 50",
        detail: "Mitad para anuncios, mitad margen operativo TrackGo.",
        icon: "wallet" as const,
        tone: "green" as const,
    },
    {
        title: "Activacion",
        value: "Pix -> Meta",
        detail: "Pago confirmado, campana en cola y asignacion por cobertura.",
        icon: "play" as const,
        tone: "blue" as const,
    },
];

const currency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
});

export default function SubscriptionsPage() {
    const permissions = usePermissions();
    const [customAmount, setCustomAmount] = useState("350");
    const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
    const [customModalOpen, setCustomModalOpen] = useState(false);

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

    return (
        <div className="space-y-4">
            <PageHeader
                title="Suscripciones Pix"
                subtitle="Maqueta inicial para vender ciclos semanales, activar presupuesto y preparar el flujo Pix + Meta."
                icon={<AppIcon name="wallet" tone="purple" plain className="text-white" />}
                actions={
                    <Button variant="secondary" className="gap-2" type="button">
                        <AppIcon name="settings" size="sm" plain className="h-4 w-4 text-current" />
                        Reglas de ciclo
                    </Button>
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

            <section className="grid gap-3 xl:grid-cols-[1fr_360px]">
                <Card>
                    <CardHeader
                        title="Planes semanales"
                        subtitle="Cada plan reserva una parte para campana y deja clara la promesa comercial."
                    />
                    <CardContent className="grid gap-3 lg:grid-cols-3">
                        {PLANS.map((plan) => (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                disabled={!canEdit}
                                onSelect={() => setSelectedPlan(plan)}
                            />
                        ))}
                    </CardContent>
                </Card>

                <Card className="overflow-hidden">
                    <CardHeader
                        title="Presupuesto personalizado"
                        subtitle="Simula un valor libre antes de generar el Pix."
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
                            disabled={!canEdit || customSimulation.amount < 100}
                            onClick={() => setCustomModalOpen(true)}
                        >
                            Simular Pix personalizado
                        </Button>
                    </CardContent>
                </Card>
            </section>

            <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
                <Card>
                    <CardHeader
                        title="Flujo recomendado"
                        subtitle="La pantalla ya queda pensada para conectar backend, Pix y Meta."
                    />
                    <CardContent>
                        <div className="space-y-3">
                            {[
                                ["1", "Crear solicitud", "Guardar subscriptionCheckout con usuario, plan, monto, ciclo y estado pending."],
                                ["2", "Generar Pix", "Backend crea una cobranca dinamica o usa proveedor Pix con webhook."],
                                ["3", "Confirmar pago", "Webhook valida txid, monto y usuario antes de activar la suscripcion."],
                                ["4", "Activar campana", "Crear/actualizar campana Meta con presupuesto, fechas y cobertura del usuario."],
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

                <Card>
                    <CardHeader
                        title="Notas de estrategia"
                        subtitle="Lo que conviene definir antes de cobrar de verdad."
                    />
                    <CardContent>
                        <div className="grid gap-2 md:grid-cols-2">
                            <StrategyNote title="Pix" body="Nubank personal puede recibir Pix, pero para automatizar necesitas proveedor/API con txid y webhook confiable." />
                            <StrategyNote title="Meta" body="Primero conviene activar campanas manual/semi-automaticas; luego automatizar con Marketing API cuando el flujo este probado." />
                            <StrategyNote title="Promesa" body="Vender rango estimado, nunca cantidad fija. La entrega depende de ciudad, competencia, pauta y respuesta del mercado." />
                            <StrategyNote title="Incompletos" body="Incluyelo como valor extra: base con negocio detectado para recuperar oportunidades sin depender solo de anuncios." />
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
                canEdit={canEdit}
                onClose={() => setSelectedPlan(null)}
            />
            <CheckoutModal
                open={customModalOpen}
                title="Pix personalizado"
                amount={customSimulation.amount}
                campaignBudget={customSimulation.campaignBudget}
                estimatedLeads={customSimulation.estimatedLeads}
                canEdit={canEdit}
                onClose={() => setCustomModalOpen(false)}
            />
        </div>
    );
}

function PlanCard({
    plan,
    disabled,
    onSelect,
}: {
    plan: SubscriptionPlan;
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
                Simular Pix
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
    canEdit,
    onClose,
}: {
    open: boolean;
    title: string;
    amount: number;
    campaignBudget: number;
    estimatedLeads: string;
    canEdit: boolean;
    onClose: () => void;
}) {
    const operation = Math.max(0, amount - campaignBudget);
    const mockPayload = `trackgo.pix.mock|amount=${amount}|budget=${campaignBudget}|cycle=5d`;

    return (
        <Modal open={open} title={title} subtitle="Vista previa. Todavia no genera cobro real." size="md" onClose={onClose}>
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                <div className="rounded-3xl border border-[#ded8ff] bg-[linear-gradient(135deg,#f8f7ff,#ffffff)] p-4">
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
                    <p className="mt-3 text-center text-[10px] font-black uppercase tracking-[0.12em] text-[#7c70ba]">
                        QR mock
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
                            Operacion TrackGo: {currency.format(operation)}. El valor real se confirmara por webhook antes de activar.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-dashed border-[#c7bfff] bg-[#f8f7ff] p-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#6d28d9]">
                            Pix copia y pega mock
                        </p>
                        <p className="mt-2 break-all rounded-xl bg-white p-2 font-mono text-[10px] font-bold text-[#52607a]">
                            {mockPayload}
                        </p>
                    </div>
                </div>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] font-semibold leading-snug text-amber-800">
                Este boton queda preparado para backend. El cobro real debe crearse en una Cloud Function para no exponer llaves Pix/Meta en el navegador.
            </div>

            <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                    Cerrar
                </Button>
                <Button type="button" variant="primary" disabled={!canEdit}>
                    Crear checkout pendiente
                </Button>
            </div>

            {/*
                TODO Pix:
                - Reemplazar este mock por una Cloud Function callable: createPixSubscriptionCheckout.
                - Guardar subscriptionCheckouts/{id}: userId, amount, campaignBudget, cycleStart, cycleEnd, status=pending, txid.
                - Generar QR dinamico o Pix copia/cola usando proveedor con webhook.

                TODO Webhook:
                - Validar txid, monto exacto, usuario y estado pendiente.
                - Cambiar status a paid y crear weeklySubscriptionCampaigns/{cycleId_userId}.

                TODO Meta:
                - Encolar activacion de campana/ad set con presupuesto, fechas y cobertura.
                - Guardar ids de campaign/adSet para pausar, consultar insights y auditar gasto.
            */}
        </Modal>
    );
}

function estimateLeadRange(campaignBudget: number) {
    if (campaignBudget <= 0) return "0-0";
    if (campaignBudget <= 150) return "10-35";
    if (campaignBudget <= 200) return "20-50";
    const min = Math.round(campaignBudget * 0.115);
    const max = Math.round(campaignBudget * 0.27);
    return `${min}-${max}`;
}
