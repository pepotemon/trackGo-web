export type LeadOperationalStatus = "pending" | "visited" | "rejected";

export type RejectedReason =
    | "clavo"
    | "localizacion"
    | "zona_riesgosa"
    | "ingresos_insuficientes"
    | "muy_endeudado"
    | "informacion_dudosa"
    | "no_le_interesa"
    | "no_estaba_cerrado"
    | "fuera_de_ruta"
    | "otro";

export const REJECTED_REASON_LABELS: Record<RejectedReason, string> = {
    clavo: "Clavo / Lead falso",
    localizacion: "Localización lejana",
    zona_riesgosa: "Zona riesgosa",
    ingresos_insuficientes: "Ingresos insuficientes",
    muy_endeudado: "Muy endeudado",
    informacion_dudosa: "Información dudosa",
    no_le_interesa: "No le interesa",
    no_estaba_cerrado: "No estaba / Cerrado",
    fuera_de_ruta: "Fuera de ruta",
    otro: "Otro",
};

export type UserLeadStats = {
    todayVisited: number;
    todayRejected: number;
    weekVisited: number;
    weekRejected: number;
};
