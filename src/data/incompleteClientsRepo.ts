import {
    collection,
    doc,
    limit,
    onSnapshot,
    query,
    updateDoc,
    where,
    type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeLeadDoc } from "@/data/leadsRepo";
import type { MetaLeadDoc } from "@/types/leads";

export const BRAZIL_DDDS: Record<string, string> = {
    "11": "São Paulo", "12": "São José dos Campos", "13": "Santos", "14": "Bauru",
    "15": "Sorocaba", "16": "Ribeirão Preto", "17": "São José do Rio Preto", "18": "Presidente Prudente",
    "19": "Campinas", "21": "Rio de Janeiro", "22": "Campos dos Goytacazes", "24": "Volta Redonda",
    "27": "Vitória", "28": "Cachoeiro de Itapemirim", "31": "Belo Horizonte", "32": "Juiz de Fora",
    "33": "Governador Valadares", "34": "Uberlândia", "35": "Poços de Caldas", "37": "Divinópolis",
    "38": "Montes Claros", "41": "Curitiba", "42": "Ponta Grossa", "43": "Londrina",
    "44": "Maringá", "45": "Foz do Iguaçu", "46": "Francisco Beltrão", "47": "Joinville",
    "48": "Florianópolis", "49": "Chapecó", "51": "Porto Alegre", "53": "Pelotas",
    "54": "Caxias do Sul", "55": "Santa Maria", "61": "Brasília", "62": "Goiânia",
    "63": "Palmas", "64": "Rio Verde", "65": "Cuiabá", "66": "Rondonópolis",
    "67": "Campo Grande", "68": "Rio Branco", "69": "Porto Velho", "71": "Salvador",
    "73": "Ilhéus", "74": "Juazeiro", "75": "Feira de Santana", "77": "Vitória da Conquista",
    "79": "Aracaju", "81": "Recife", "82": "Maceió", "83": "João Pessoa",
    "84": "Natal", "85": "Fortaleza", "86": "Teresina", "87": "Petrolina",
    "88": "Juazeiro do Norte", "89": "Picos", "91": "Belém", "92": "Manaus",
    "93": "Santarém", "94": "Marabá", "95": "Boa Vista", "96": "Macapá",
    "97": "Coari", "98": "São Luís", "99": "Imperatriz",
};

const INTL_COUNTRY_CODES = ["507","502","503","504","505","506","509","593","591","595","598"];

const COUNTRY_NAMES: Record<string, string> = {
    "507": "Panamá", "502": "Guatemala", "503": "El Salvador", "504": "Honduras",
    "505": "Nicaragua", "506": "Costa Rica", "509": "Rep. Dom.", "593": "Ecuador",
    "591": "Bolivia", "595": "Paraguay", "598": "Uruguay",
};

export function dddCity(ddd: string): string {
    return BRAZIL_DDDS[ddd] ?? COUNTRY_NAMES[ddd] ?? `+${ddd}`;
}

export function extractDDD(phone: string): string | null {
    const digits = phone.replace(/\D/g, "");
    // Brazil with country code: +55 XX NNNN-NNNN (≥12 digits)
    if (digits.startsWith("55") && digits.length >= 12) return digits.slice(2, 4);
    // Non-Brazil 3-digit country codes (Central/South America)
    for (const cc of INTL_COUNTRY_CODES) {
        if (digits.startsWith(cc)) return cc;
    }
    // Brazil local format: XX NNNN-NNNN
    if (digits.length >= 10 && digits.length <= 11) return digits.slice(0, 2);
    return null;
}

function matchesCoverage(lead: MetaLeadDoc, phoneCodes: string[]): boolean {
    const code = extractDDD(lead.phone);
    return code !== null && phoneCodes.includes(code);
}

/**
 * Incomplete clients: pending_review, not assigned to anyone, business field filled.
 * These are clients who sent their business type but didn't complete the flow.
 */
export function subscribeIncompleteClients(
    phoneCodes: string[],
    callback: (leads: MetaLeadDoc[]) => void
): Unsubscribe {
    if (!phoneCodes.length) {
        callback([]);
        return () => {};
    }

    const q = query(
        collection(db, "clients"),
        where("verificationStatus", "in", ["pending_review", "incomplete"]),
        limit(300)
    );

    return onSnapshot(
        q,
        (snap) => {
            const filtered = snap.docs
                .map((d) => normalizeLeadDoc(d.id, d.data() as Record<string, unknown>))
                .filter((lead) =>
                    matchesCoverage(lead, phoneCodes) &&
                    !!lead.business &&           // must have business field
                    !lead.assignedTo             // must not be assigned to anyone
                )
                .sort((a, b) => (b.lastInboundMessageAt ?? 0) - (a.lastInboundMessageAt ?? 0));
            callback(filtered);
        },
        (err) => {
            console.error("[subscribeIncompleteClients]", err.message);
            callback([]);
        }
    );
}

/**
 * Not-suitable clients in vendor's coverage area.
 * These were marked as not_suitable by this vendor or admin.
 */
export function subscribeNotSuitableClients(
    phoneCodes: string[],
    callback: (leads: MetaLeadDoc[]) => void
): Unsubscribe {
    if (!phoneCodes.length) {
        callback([]);
        return () => {};
    }

    const q = query(
        collection(db, "clients"),
        where("verificationStatus", "==", "not_suitable"),
        limit(300)
    );

    return onSnapshot(
        q,
        (snap) => {
            const filtered = snap.docs
                .map((d) => normalizeLeadDoc(d.id, d.data() as Record<string, unknown>))
                .filter((lead) => matchesCoverage(lead, phoneCodes))
                .sort((a, b) => (b.verificationStatusChangedAt ?? b.lastInboundMessageAt ?? 0) - (a.verificationStatusChangedAt ?? a.lastInboundMessageAt ?? 0));
            callback(filtered);
        },
        (err) => {
            console.error("[subscribeNotSuitableClients]", err.message);
            callback([]);
        }
    );
}

/** Mark an incomplete (pending_review, unassigned) client as not suitable. */
export async function markClientNotSuitable(clientId: string): Promise<void> {
    await updateDoc(doc(db, "clients", clientId), {
        verificationStatus: "not_suitable",
        leadQuality: "not_suitable",
        verificationStatusChangedAt: Date.now(),
        updatedAt: Date.now(),
    });
}

/** Assign a not_suitable client to a vendor and reset it to pending_review so it appears in their prospectos. */
export async function takeNotSuitableClient(clientId: string, userId: string): Promise<void> {
    const now = Date.now();
    await updateDoc(doc(db, "clients", clientId), {
        assignedTo: userId,
        assignedAt: now,
        status: "pending",
        statusBy: null,
        statusAt: null,
        verificationStatus: "pending_review",
        leadQuality: "review",
        verificationStatusChangedAt: now,
        updatedAt: now,
    });
}
