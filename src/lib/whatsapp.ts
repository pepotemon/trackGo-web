const LATAM_3_DIGIT_COUNTRY_CODES = [
    "507",
    "502",
    "503",
    "504",
    "505",
    "506",
    "509",
    "591",
    "593",
    "595",
    "598",
];

const LATAM_2_DIGIT_COUNTRY_CODES = ["52", "54", "56", "57", "58"];

export function normalizeWhatsAppPhone(phone?: string | null) {
    const digits = String(phone ?? "").replace(/\D+/g, "");
    if (!digits) return "";

    if (LATAM_3_DIGIT_COUNTRY_CODES.some((code) => digits.startsWith(code))) return digits;
    if (LATAM_2_DIGIT_COUNTRY_CODES.some((code) => digits.startsWith(code))) return digits;

    if (digits.startsWith("55")) {
        const withoutBrazilPrefix = digits.slice(2);
        if (LATAM_3_DIGIT_COUNTRY_CODES.some((code) => withoutBrazilPrefix.startsWith(code))) {
            return withoutBrazilPrefix;
        }
        return digits;
    }

    return `55${digits}`;
}

export function buildWhatsAppUrl(phone?: string | null, message?: string) {
    const normalized = normalizeWhatsAppPhone(phone);
    if (!normalized) return "";

    const query = message ? `?text=${encodeURIComponent(message)}` : "";
    return `https://wa.me/${normalized}${query}`;
}
