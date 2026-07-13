const { logger } = require("firebase-functions");
const { db } = require("../core/firebase");
const { sendWhatsAppText } = require("../whatsapp/sender");
const { appendClientMessage, isBotAllowedForClient } = require("../whatsapp/manualReply");
const { getWhatsappChannelFromClient } = require("../whatsapp/channels");
const { safeString, safeNumber, stripUndefined } = require("../utils/text");
const { isInterestExpressed } = require("../bot/intents");

const WINDOW_HOURS = 24;
const DEFAULT_HOURS_BEFORE_DEADLINE = 5;
const DEFAULT_MAX_CLIENTS_PER_RUN = 300;
const DEFAULT_MAX_REMINDERS_PER_CLIENT = 2;

function nowMs() {
    return Date.now();
}

function hoursToMs(hours) {
    return Math.max(0, Number(hours || 0)) * 60 * 60 * 1000;
}

function hasUsefulBusiness(client) {
    return !!safeString(client?.business || client?.businessRaw || "");
}

function hasRequiredMapsForFlow(client) {
    const mapsUrl = !!safeString(client?.mapsUrl || "");
    const lat = safeNumber(client?.lat, null);
    const lng = safeNumber(client?.lng, null);
    return mapsUrl || (lat !== null && lng !== null);
}

function getMissingInfoType(client) {
    if (safeString(client?.parseStatus || "") === "ready") return "";

    const hasBusiness = hasUsefulBusiness(client);
    const hasMaps = hasRequiredMapsForFlow(client);

    if (!hasBusiness && !hasMaps) return "business_maps";
    if (!hasBusiness) return "business";
    if (!hasMaps) return "maps";
    return "";
}

function buildShortMissingInfoReminderPtBr(missingType, hasInterest) {
    if (hasInterest) {
        if (missingType === "business") {
            return [
                "Olá 👋",
                "",
                "Seu cadastro ainda não foi concluído — falta o tipo de comércio.",
                "Ainda dá tempo, pode me enviar aqui.",
            ].join("\n");
        }

        if (missingType === "maps") {
            return [
                "Olá 👋",
                "",
                "Seu cadastro ainda não foi concluído — falta a localização do comércio no Google Maps.",
                "Ainda dá tempo, pode me enviar aqui.",
            ].join("\n");
        }

        return [
            "Olá 👋",
            "",
            "Seu cadastro ainda não foi concluído — falta o tipo de comércio e a localização no Google Maps.",
            "Ainda dá tempo, pode me enviar aqui.",
        ].join("\n");
    }

    if (missingType === "business") {
        return [
            "Olá 👋",
            "",
            "Ainda preciso do tipo de comércio para completar sua análise.",
            "Se ainda tiver interesse, pode me enviar por aqui.",
        ].join("\n");
    }

    if (missingType === "maps") {
        return [
            "Olá 👋",
            "",
            "Ainda preciso da localização do comércio no Google Maps para completar sua análise.",
            "Se ainda tiver interesse, pode me enviar por aqui.",
        ].join("\n");
    }

    return [
        "Olá 👋",
        "",
        "Ainda preciso do tipo de comércio e da localização no Google Maps para completar sua análise.",
        "Se ainda tiver interesse, pode me enviar por aqui.",
    ].join("\n");
}

function buildShortMissingInfoReminderEsPa(missingType, hasInterest) {
    if (hasInterest) {
        if (missingType === "business") {
            return [
                "Hola.",
                "",
                "Tu registro todavia no esta completo — falta el tipo de negocio.",
                "Todavia hay tiempo, puedes enviarmelo aqui.",
            ].join("\n");
        }

        if (missingType === "maps") {
            return [
                "Hola.",
                "",
                "Tu registro todavia no esta completo — falta la ubicacion del negocio en Google Maps.",
                "Todavia hay tiempo, puedes enviarmela aqui.",
            ].join("\n");
        }

        return [
            "Hola.",
            "",
            "Tu registro todavia no esta completo — falta el tipo de negocio y la ubicacion en Google Maps.",
            "Todavia hay tiempo, puedes enviarmelos aqui.",
        ].join("\n");
    }

    if (missingType === "business") {
        return [
            "Hola.",
            "",
            "Todavia necesito el tipo de negocio para completar tu analisis.",
            "Si sigues con interes, puedes enviarmelo por aqui.",
        ].join("\n");
    }

    if (missingType === "maps") {
        return [
            "Hola.",
            "",
            "Todavia necesito la ubicacion del negocio en Google Maps para completar tu analisis.",
            "Si sigues con interes, puedes enviarmela por aqui.",
        ].join("\n");
    }

    return [
        "Hola.",
        "",
        "Todavia necesito el tipo de negocio y la ubicacion en Google Maps para completar tu analisis.",
        "Si sigues con interes, puedes enviarmelos por aqui.",
    ].join("\n");
}

function buildShortMissingInfoReminder(missingType, language, hasInterest) {
    if (safeString(language || "").startsWith("es")) {
        return buildShortMissingInfoReminderEsPa(missingType, hasInterest);
    }

    return buildShortMissingInfoReminderPtBr(missingType, hasInterest);
}

function shouldSkipReminder(
    client,
    now,
    reminderCutoffMs,
    maxRemindersPerClient = DEFAULT_MAX_REMINDERS_PER_CLIENT
) {
    const source = safeString(client?.source || "");
    const leadQuality = safeString(client?.leadQuality || "");
    const verificationStatus = safeString(client?.verificationStatus || "");
    const leadStatus = safeString(client?.status || "");
    const introSentAt = safeNumber(client?.initialIntroSentAt, 0);
    const lastInboundMessageAt = safeNumber(client?.lastInboundMessageAt, 0);
    const lastMissingInfoReminderAt = safeNumber(client?.lastMissingInfoReminderAt, 0);
    const lastMissingInfoReminderCount = safeNumber(client?.lastMissingInfoReminderCount, 0);
    const lastManualReplyAt = safeNumber(client?.lastManualReplyAt, 0);
    const assignedTo = safeString(client?.assignedTo || "");
    const lastBotStage = safeString(client?.lastBotStage || "");

    if (source !== "whatsapp_meta") {
        return { skip: true, reason: "not_whatsapp_meta" };
    }

    if (leadStatus === "rejected" || leadStatus === "visited") {
        return { skip: true, reason: "lead_already_actioned" };
    }

    if (!introSentAt) {
        return { skip: true, reason: "intro_not_sent" };
    }

    if (!lastInboundMessageAt) {
        return { skip: true, reason: "no_last_inbound" };
    }

    if (leadQuality === "not_suitable") {
        return { skip: true, reason: "not_suitable_quality" };
    }

    if (verificationStatus === "not_suitable") {
        return { skip: true, reason: "not_suitable_verification" };
    }

    if (verificationStatus === "verified") {
        return { skip: true, reason: "already_verified" };
    }

    if (assignedTo) {
        return { skip: true, reason: "already_assigned" };
    }

    if (!isBotAllowedForClient(client)) {
        return { skip: true, reason: "bot_not_allowed" };
    }

    if (lastBotStage === "final:not_suitable") {
        return { skip: true, reason: "already_closed_not_suitable" };
    }

    if (lastMissingInfoReminderCount >= maxRemindersPerClient) {
        return { skip: true, reason: "max_reminders_reached" };
    }

    const missingType = getMissingInfoType(client);
    if (!missingType) {
        return { skip: true, reason: "nothing_missing" };
    }

    const deadlineAt = lastInboundMessageAt + hoursToMs(WINDOW_HOURS);
    const reminderAt = deadlineAt - reminderCutoffMs;

    if (now < reminderAt) {
        return { skip: true, reason: "too_early" };
    }

    if (now >= deadlineAt) {
        return { skip: true, reason: "window_closed" };
    }

    if (lastMissingInfoReminderAt > 0 && lastMissingInfoReminderAt >= lastInboundMessageAt) {
        return { skip: true, reason: "already_reminded_current_cycle" };
    }

    if (lastManualReplyAt > 0 && lastManualReplyAt >= lastInboundMessageAt) {
        return { skip: true, reason: "human_recently_replied" };
    }

    return {
        skip: false,
        reason: "",
        missingType,
        deadlineAt,
        reminderAt,
    };
}

async function processClientReminder({
    clientId,
    client,
    now,
    missingType,
}) {
    const waId = safeString(client?.waId || client?.phone || "");
    if (!waId) {
        return { ok: false, reason: "missing_waid" };
    }

    const channel = getWhatsappChannelFromClient(client);
    const hasInterest = isInterestExpressed(safeString(client?.lastInboundText || ""));
    const body = buildShortMissingInfoReminder(missingType, channel.language, hasInterest);
    const sendResult = await sendWhatsAppText(waId, body, {
        phoneNumberId: channel.phoneNumberId,
    });
    const whatsappMessageId = safeString(sendResult?.messages?.[0]?.id || "");

    await appendClientMessage({
        clientId,
        direction: "outbound",
        senderType: "bot",
        senderId: "system_bot",
        text: body,
        messageType: "text",
        whatsappMessageId,
        status: "sent",
        meta: {
            source: "bot_reminder",
            stage: `reminder:missing:${missingType}`,
            reminderType: missingType,
            hasInterest,
            whatsappPhoneNumberId: channel.phoneNumberId,
            language: channel.language,
            marketCountry: channel.marketCountry,
        },
    });

    await db.doc(`clients/${clientId}`).set(
        stripUndefined({
            updatedAt: now,
            lastOutboundAt: now,
            lastBotReplyAt: now,
            lastBotReplyText: body,
            lastBotStage: `reminder:missing:${missingType}`,
            lastMissingInfoReminderAt: now,
            lastMissingInfoReminderType: missingType,
            lastMissingInfoReminderText: body,
            lastMissingInfoReminderCount:
                safeNumber(client?.lastMissingInfoReminderCount, 0) + 1,
        }),
        { merge: true }
    );

    return {
        ok: true,
        reason: "sent",
        whatsappMessageId,
    };
}

function createReminderMissingInfoJob({
    hoursBeforeDeadline = DEFAULT_HOURS_BEFORE_DEADLINE,
    maxClientsPerRun = DEFAULT_MAX_CLIENTS_PER_RUN,
    maxRemindersPerClient = DEFAULT_MAX_REMINDERS_PER_CLIENT,
} = {}) {
    const reminderCutoffMs = hoursToMs(hoursBeforeDeadline);

    return async function reminderMissingInfoJob() {
        const startedAt = nowMs();

        logger.info("[REMINDER] job started", {
            hoursBeforeDeadline,
            maxClientsPerRun,
            maxRemindersPerClient,
        });

        const snap = await db
            .collection("clients")
            .where("source", "==", "whatsapp_meta")
            .limit(maxClientsPerRun)
            .get();

        let inspected = 0;
        let eligible = 0;
        let sent = 0;
        let skipped = 0;
        let failed = 0;

        for (const doc of snap.docs) {
            inspected += 1;

            const clientId = doc.id;
            const client = doc.data() || {};
            const now = nowMs();

            try {
                const decision = shouldSkipReminder(
                    client,
                    now,
                    reminderCutoffMs,
                    maxRemindersPerClient
                );

                if (decision.skip) {
                    skipped += 1;
                    continue;
                }

                eligible += 1;

                const result = await processClientReminder({
                    clientId,
                    client,
                    now,
                    missingType: decision.missingType,
                });

                if (result.ok) {
                    sent += 1;
                    logger.info("[REMINDER] sent", {
                        clientId,
                        missingType: decision.missingType,
                        whatsappMessageId: result.whatsappMessageId || "",
                        reminderCountAfterSend:
                            safeNumber(client?.lastMissingInfoReminderCount, 0) + 1,
                    });
                } else {
                    failed += 1;
                    logger.warn("[REMINDER] not_sent", {
                        clientId,
                        reason: result.reason,
                    });
                }
            } catch (error) {
                failed += 1;
                logger.error("[REMINDER] client error", {
                    clientId,
                    error: String(error?.message || error || "unknown_error"),
                });
            }
        }

        logger.info("[REMINDER] job finished", {
            inspected,
            eligible,
            sent,
            skipped,
            failed,
            durationMs: nowMs() - startedAt,
        });
    };
}

module.exports = {
    WINDOW_HOURS,
    DEFAULT_HOURS_BEFORE_DEADLINE,
    DEFAULT_MAX_CLIENTS_PER_RUN,
    DEFAULT_MAX_REMINDERS_PER_CLIENT,
    hasUsefulBusiness,
    hasRequiredMapsForFlow,
    getMissingInfoType,
    buildShortMissingInfoReminderPtBr,
    shouldSkipReminder,
    createReminderMissingInfoJob,
};
