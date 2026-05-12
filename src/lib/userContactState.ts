const WA_SENT_PREFIX = "lead_whatsapp_sent_";
const REVIEWED_PREFIX = "lead_reviewed_";

function canUseStorage() {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getWhatsAppSentIds(leadIds: string[]) {
    if (!canUseStorage()) return new Set<string>();
    return new Set(
        leadIds.filter((id) => window.localStorage.getItem(`${WA_SENT_PREFIX}${id}`) === "1")
    );
}

export function markWhatsAppSent(leadId: string) {
    if (!canUseStorage()) return;
    window.localStorage.setItem(`${WA_SENT_PREFIX}${leadId}`, "1");
}

export function getReviewedIds(leadIds: string[]) {
    if (!canUseStorage()) return new Set<string>();
    return new Set(
        leadIds.filter((id) => window.localStorage.getItem(`${REVIEWED_PREFIX}${id}`) === "1")
    );
}

export function markReviewed(leadId: string) {
    if (!canUseStorage()) return;
    window.localStorage.setItem(`${REVIEWED_PREFIX}${leadId}`, "1");
}
