export function dayKeyFromDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function weekRangeKeysMonToSun(base = new Date()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);

    const jsDay = d.getDay();
    const diffToMonday = jsDay === 0 ? 6 : jsDay - 1;

    const start = new Date(d);
    start.setDate(d.getDate() - diffToMonday);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    return {
        startKey: dayKeyFromDate(start),
        endKey: dayKeyFromDate(end),
        startDate: start,
        endDate: end,
    };
}

export const weekRangeKeysMonToSat = weekRangeKeysMonToSun;

export function addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

export function money(n: number) {
    return `R$ ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}
