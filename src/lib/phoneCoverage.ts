const INTL_COUNTRY_CODES = ["507", "502", "503", "504", "505", "506", "509", "593", "591", "595", "598"];

function digits(value: unknown) {
    return String(value ?? "").replace(/\D+/g, "");
}

export function extractPhoneCoverageCode(phone: unknown): string | null {
    const value = digits(phone);

    if (value.startsWith("55")) {
        const stripped = value.slice(2);
        for (const cc of INTL_COUNTRY_CODES) {
            if (stripped.startsWith(cc)) return cc;
        }
    }

    for (const cc of INTL_COUNTRY_CODES) {
        if (value.startsWith(cc)) return cc;
    }

    if (value.startsWith("55") && value.length >= 12) return value.slice(2, 4);
    if (value.length >= 10 && value.length <= 11) return value.slice(0, 2);

    return null;
}

export function phoneMatchesCoverageCodes(phone: unknown, codes: Iterable<string>) {
    const code = extractPhoneCoverageCode(phone);
    if (!code) return false;
    return new Set(Array.from(codes).map((item) => digits(item)).filter(Boolean)).has(code);
}

