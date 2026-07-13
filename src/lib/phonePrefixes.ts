import { extractPhoneCoverageCode } from "@/lib/phoneCoverage";

export type PhonePrefixOption = {
    value: string;
    label: string;
    kind: "state" | "country";
};

const BRAZIL_DDDS: Record<string, string> = {
    "11": "Sao Paulo",
    "12": "Sao Paulo",
    "13": "Sao Paulo",
    "14": "Sao Paulo",
    "15": "Sao Paulo",
    "16": "Sao Paulo",
    "17": "Sao Paulo",
    "18": "Sao Paulo",
    "19": "Sao Paulo",
    "21": "Rio de Janeiro",
    "22": "Rio de Janeiro",
    "24": "Rio de Janeiro",
    "27": "Espirito Santo",
    "28": "Espirito Santo",
    "31": "Minas Gerais",
    "32": "Minas Gerais",
    "33": "Minas Gerais",
    "34": "Minas Gerais",
    "35": "Minas Gerais",
    "37": "Minas Gerais",
    "38": "Minas Gerais",
    "41": "Parana",
    "42": "Parana",
    "43": "Parana",
    "44": "Parana",
    "45": "Parana",
    "46": "Parana",
    "47": "Santa Catarina",
    "48": "Santa Catarina",
    "49": "Santa Catarina",
    "51": "Rio Grande do Sul",
    "53": "Rio Grande do Sul",
    "54": "Rio Grande do Sul",
    "55": "Rio Grande do Sul",
    "61": "Distrito Federal / Goias",
    "62": "Goias",
    "63": "Tocantins",
    "64": "Goias",
    "65": "Mato Grosso",
    "66": "Mato Grosso",
    "67": "Mato Grosso do Sul",
    "68": "Acre",
    "69": "Rondonia",
    "71": "Bahia",
    "73": "Bahia",
    "74": "Bahia",
    "75": "Bahia",
    "77": "Bahia",
    "79": "Sergipe",
    "81": "Pernambuco",
    "82": "Alagoas",
    "83": "Paraiba",
    "84": "Rio Grande do Norte",
    "85": "Ceara",
    "86": "Piaui",
    "87": "Pernambuco",
    "88": "Ceara",
    "89": "Piaui",
    "91": "Para",
    "92": "Amazonas",
    "93": "Para",
    "94": "Para",
    "95": "Roraima",
    "96": "Amapa",
    "97": "Amazonas",
    "98": "Maranhao",
    "99": "Maranhao",
};

const LATAM_COUNTRIES: Record<string, string> = {
    "54": "Argentina",
    "502": "Guatemala",
    "503": "El Salvador",
    "504": "Honduras",
    "505": "Nicaragua",
    "506": "Costa Rica",
    "507": "Panama",
    "509": "Haiti",
    "591": "Bolivia",
    "593": "Ecuador",
    "595": "Paraguay",
    "598": "Uruguay",
};

export function phonePrefixFilterValue(phone: unknown) {
    const code = extractPhoneCoverageCode(phone);
    if (!code) return "unknown";
    if (BRAZIL_DDDS[code]) return `phone:${code}`;
    if (LATAM_COUNTRIES[code]) return `country:${code}`;
    return `phone:${code}`;
}

export function phonePrefixLabel(value: string) {
    if (value === "unknown") return "Sin indicativo";

    const [kind, code] = value.split(":");
    if (!code) return value;

    if (kind === "country") {
        return `${code} - ${LATAM_COUNTRIES[code] ?? "Pais"}`;
    }

    return `${code} - ${BRAZIL_DDDS[code] ?? "Indicativo"}`;
}

export function buildPhonePrefixOptions(phones: string[]): PhonePrefixOption[] {
    const values = new Set<string>();

    for (const phone of phones) {
        const value = phonePrefixFilterValue(phone);
        if (value !== "unknown") values.add(value);
    }

    return Array.from(values)
        .map((value) => ({
            value,
            label: phonePrefixLabel(value),
            kind: value.startsWith("country:") ? "country" as const : "state" as const,
        }))
        .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
            return a.label.localeCompare(b.label, "es", { numeric: true });
        });
}

export function leadMatchesPhonePrefix(phone: unknown, filterValue: string) {
    if (filterValue === "all") return true;
    return phonePrefixFilterValue(phone) === filterValue;
}
