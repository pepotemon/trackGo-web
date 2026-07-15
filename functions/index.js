const {
    onDocumentCreated,
    onDocumentUpdated,
} = require("firebase-functions/v2/firestore");
const { createManagedUser } = require("./src/users/createManagedUser");
const { updateManagedUserAuth } = require("./src/users/updateManagedUserAuth");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getAuth } = require("firebase-admin/auth");

const { db } = require("./src/core/firebase");
const { WHATSAPP_VERIFY_TOKEN } = require("./src/config/params");

const { createReminderMissingInfoJob } = require("./src/cron/reminderMissingInfo");

const { looksLikeSystemOrMetaMessage } = (() => {
    const { normalizeLooseText } = require("./src/utils/text");

    return {
        looksLikeSystemOrMetaMessage(text, profileName, waId) {
            const s = normalizeLooseText(text);
            const p = normalizeLooseText(profileName);

            if (!s) return true;

            if (p === "whatsapp business" || p === "meta") return true;
            if (waId === "16465894168") return true;

            const blockedPhrases = [
                "continue setting up your account",
                "setup guidance",
                "whatsapp manager",
                "you have a few steps left",
                "get detailed instructions",
                "track progress for your number",
                "new setup guidance",
                "learn more about",
                "saiba mais sobre",
                "configure sua conta",
                "configurar sua conta",
                "continue configurando",
                "test whatsapp business account",
            ];

            return blockedPhrases.some((x) => s.includes(normalizeLooseText(x)));
        },
    };
})();

const { looksLikeBrazilAddress } = require("./src/utils/geo");
const { sendWhatsAppText } = require("./src/whatsapp/sender");

const {
    appendClientMessage,
    isBotAllowedForClient,
    sendManualWhatsAppMessage,
    resumeBotForClient,
} = require("./src/whatsapp/manualReply");

const { notifyAssignedUser, notifyAssignedLeadAdmins } = require("./src/push/expoPush");

const business = require("./src/bot/business");
const namesFactory = require("./src/bot/names");

const { createLeadParser } = require("./src/bot/parser");
const { createBotReplyBuilder } = require("./src/bot/replies");
const { createBotReplyBuilderEsPa } = require("./src/bot/repliesEsPa");
const {
    OPENAI_API_KEY,
    analyzeLeadReplyWithAi,
    buildAutomationLimitReply,
    canReactivateAutomation,
    shouldStopAutomatedConversation,
    shouldTryAiLeadAssistant,
} = require("./src/bot/aiLeadAssistant");
const leadState = require("./src/bot/leadState");

const { createUpsertLeadAsClient } = require("./src/whatsapp/upsertLead");
const { createProcessIncomingWhatsappMessage } = require("./src/whatsapp/processIncoming");
const { getWhatsappChannelFromClient } = require("./src/whatsapp/channels");

const isBadProfileName = namesFactory.isBadProfileNameFactory({
    isLikelyBusinessLine: business.isLikelyBusinessLine,
});

const sanitizeExplicitPersonName = namesFactory.sanitizeExplicitPersonNameFactory({
    isLikelyBusinessLine: business.isLikelyBusinessLine,
});

const sanitizeFallbackProfileName = namesFactory.sanitizeFallbackProfileNameFactory({
    isBadProfileName,
});

const looksLikePersonName = namesFactory.looksLikePersonNameFactory({
    isLikelyBusinessLine: business.isLikelyBusinessLine,
    looksLikeGreetingOrInterestText: business.looksLikeGreetingOrInterestText,
});

const resolveNextClientName = namesFactory.resolveNextClientNameFactory({
    isBadProfileName,
    sanitizeFallbackProfileName,
});

const isPossibleBusinessFallbackText = business.isPossibleBusinessFallbackTextFactory({
    looksLikePersonName,
});

function sanitizeAddress(address) {
    const { cleanupExtractedText, normalizeLooseText } = require("./src/utils/text");

    const v = cleanupExtractedText(address);
    if (!v) return "";

    const s = normalizeLooseText(v);

    if (
        s.includes("http://") ||
        s.includes("https://") ||
        s.includes("setup guidance") ||
        s.includes("whatsapp manager")
    ) {
        return "";
    }

    if (!looksLikeBrazilAddress(v) && v.length < 10) return "";

    return v;
}

const parseLeadText = createLeadParser({
    sanitizeExplicitPersonName,
    sanitizeFallbackProfileName,
    looksLikePersonName,
    sanitizeAddress,
    isLikelyBusinessLine: business.isLikelyBusinessLine,
    normalizeBusinessLabel: business.normalizeBusinessLabel,
    sanitizeBusiness: business.sanitizeBusiness,
    isPossibleBusinessFallbackText,
    classifyBusinessQuality: business.classifyBusinessQuality,
    getBusinessFlags: business.getBusinessFlags,
});

const hasUsefulName = leadState.hasUsefulNameFactory({ isBadProfileName });
const getFinalParseStatus = leadState.getFinalParseStatusFactory({ hasUsefulName });

const buildBotReplyPtBr = createBotReplyBuilder({
    hasUsefulBusiness: leadState.hasUsefulBusiness,
    hasRequiredMapsForFlow: leadState.hasRequiredMapsForFlow,
});

const buildBotReplyEsPa = createBotReplyBuilderEsPa({
    hasUsefulBusiness: leadState.hasUsefulBusiness,
    hasRequiredMapsForFlow: leadState.hasRequiredMapsForFlow,
});

async function requireAdminUser(req) {
    const authHeader = String(req.headers.authorization || "");
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match?.[1]) {
        const err = new Error("missing_authorization_token");
        err.statusCode = 401;
        throw err;
    }

    const decoded = await getAuth().verifyIdToken(match[1]);
    const uid = String(decoded?.uid || "").trim();

    if (!uid) {
        const err = new Error("invalid_auth_user");
        err.statusCode = 401;
        throw err;
    }

    const userSnap = await db.doc(`users/${uid}`).get();

    if (!userSnap.exists) {
        const err = new Error("admin_user_not_found");
        err.statusCode = 403;
        throw err;
    }

    const user = userSnap.data() || {};

    if (user.role !== "admin" || user.active !== true) {
        const err = new Error("admin_required");
        err.statusCode = 403;
        throw err;
    }

    return { uid, user };
}

async function requireActivePanelUser(req) {
    const authHeader = String(req.headers.authorization || "");
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match?.[1]) {
        const err = new Error("missing_authorization_token");
        err.statusCode = 401;
        throw err;
    }

    const decoded = await getAuth().verifyIdToken(match[1]);
    const uid = String(decoded?.uid || "").trim();

    if (!uid) {
        const err = new Error("invalid_auth_user");
        err.statusCode = 401;
        throw err;
    }

    const userSnap = await db.doc(`users/${uid}`).get();

    if (!userSnap.exists) {
        const err = new Error("user_not_found");
        err.statusCode = 403;
        throw err;
    }

    const user = userSnap.data() || {};

    if (user.active !== true || !["admin", "user"].includes(String(user.role || ""))) {
        const err = new Error("active_panel_user_required");
        err.statusCode = 403;
        throw err;
    }

    return { uid, user };
}

const LATAM_COUNTRY_CODES = ["507", "502", "503", "504", "505", "506", "509", "593", "591", "595", "598"];

function extractPhoneCoverageCode(phone) {
    const value = String(phone || "").replace(/\D/g, "");

    if (value.startsWith("55")) {
        const stripped = value.slice(2);
        for (const cc of LATAM_COUNTRY_CODES) {
            if (stripped.startsWith(cc)) return cc;
        }
    }

    for (const cc of LATAM_COUNTRY_CODES) {
        if (value.startsWith(cc)) return cc;
    }

    if (value.startsWith("55") && value.length >= 12) return value.slice(2, 4);
    if (value.length >= 10 && value.length <= 11) return value.slice(0, 2);

    return "";
}

async function assertCanSendManualMessage({ uid, user, clientId }) {
    if (user.role === "admin") return;

    const clientSnap = await db.doc(`clients/${clientId}`).get();

    if (!clientSnap.exists) {
        const err = new Error("client_not_found");
        err.statusCode = 404;
        throw err;
    }

    const client = clientSnap.data() || {};
    const assignedTo = String(client.assignedTo || "").trim();
    const takenFromIncompleteAt = Number(client.takenFromIncompleteAt || 0);
    const status = String(client.status || "pending").trim() || "pending";
    const verificationStatus = String(client.verificationStatus || "").trim();
    const userPermissions = user.userPermissions && typeof user.userPermissions === "object"
        ? user.userPermissions
        : {};
    const canChatWithProspects = userPermissions.canChatWithProspects === true;

    if (assignedTo !== uid) {
        if (assignedTo) {
            const err = new Error("client_not_assigned_to_user");
            err.statusCode = 403;
            throw err;
        }

        const allowedRecoveryStatuses = new Set(["pending_review", "incomplete", "not_suitable"]);
        const phoneCode = extractPhoneCoverageCode(client.phone || client.waId || "");
        const userPhoneCodes = Array.isArray(user.phoneCodes)
            ? user.phoneCodes.map((item) => String(item || "").replace(/\D/g, "")).filter(Boolean)
            : [];

        if (!allowedRecoveryStatuses.has(verificationStatus)) {
            const err = new Error("client_chat_not_enabled");
            err.statusCode = 403;
            throw err;
        }

        if (!phoneCode || !userPhoneCodes.includes(phoneCode)) {
            const err = new Error("client_out_of_user_coverage");
            err.statusCode = 403;
            throw err;
        }

        return;
    }

    if (Number.isFinite(takenFromIncompleteAt) && takenFromIncompleteAt > 0) {
        return;
    }

    if (canChatWithProspects && status === "pending") {
        return;
    }

    if (!Number.isFinite(takenFromIncompleteAt) || takenFromIncompleteAt <= 0) {
        const err = new Error("client_chat_not_enabled");
        err.statusCode = 403;
        throw err;
    }
}

async function maybeReplyToLead({
    clientId,
    waId,
    messageType,
    inboxRef,
}) {
    if (!clientId || !waId) return;

    const clientRef = db.doc(`clients/${clientId}`);
    const snap = await clientRef.get();

    if (!snap.exists) return;

    const client = snap.data() || {};
    const { safeString, safeNumber } = require("./src/utils/text");
    const nowBeforeBotChecks = Date.now();
    const shouldReactivateAutomation = canReactivateAutomation(client, nowBeforeBotChecks);

    if (!isBotAllowedForClient(client) && !shouldReactivateAutomation) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "human_takeover_active",
            chatMode: safeString(client?.chatMode || ""),
            assignedTo: safeString(client?.assignedTo || ""),
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "human_takeover_active",
                botReplyAt: Date.now(),
            },
            { merge: true }
        );
        return;
    }

    if (shouldReactivateAutomation) {
        await clientRef.set(
            {
                chatMode: "bot",
                botPausedAt: 0,
                botPausedBy: "",
                botReactivationActive: true,
                botReactivationStartedAt: nowBeforeBotChecks,
                botReactivationCount: safeNumber(client?.botReactivationCount, 0) + 1,
                botReactivationReplyCount: 0,
                humanNeededReason: "",
                reactivatedFromAutomationLimitAt: nowBeforeBotChecks,
            },
            { merge: true }
        );
        client.chatMode = "bot";
        client.botPausedAt = 0;
        client.botPausedBy = "";
        client.botReactivationActive = true;
        client.botReactivationReplyCount = 0;
    }

    if (!leadState.shouldSendBotReply(client)) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "reply_rules_blocked",
            parseStatus: safeString(client?.parseStatus || ""),
            verificationStatus: safeString(client?.verificationStatus || ""),
            lastBotStage: safeString(client?.lastBotStage || ""),
            chatMode: safeString(client?.chatMode || ""),
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "reply_rules_blocked",
                botReplyAt: Date.now(),
            },
            { merge: true }
        );
        return;
    }

    const channel = getWhatsappChannelFromClient(client);
    const reply =
        safeString(channel?.language || "").startsWith("es")
            ? buildBotReplyEsPa({ client, messageType })
            : buildBotReplyPtBr({ client, messageType });

    let body = safeString(reply?.body || "");
    let currentBotStage = safeString(reply?.stage || "");
    let aiResult = null;
    let aiReplyStatus = "not_used";
    let aiReplyError = "";
    const reachedAutomationLimit = shouldStopAutomatedConversation(client);
    const shouldTryAi = !reachedAutomationLimit && shouldTryAiLeadAssistant({ client, reply });

    if (reachedAutomationLimit) {
        body = buildAutomationLimitReply({ client, channel });
        currentBotStage = "limit:human_needed";
    }

    let recentMessages = [];
    if (shouldTryAi) {
        try {
            const msgsSnap = await db
                .collection("clients")
                .doc(clientId)
                .collection("messages")
                .orderBy("createdAt", "desc")
                .limit(8)
                .get();
            recentMessages = msgsSnap.docs
                .reverse()
                .map((d) => d.data())
                .map((m) => ({
                    role: safeString(m.direction || "") === "outbound" ? "bot" : "client",
                    text: safeString(m.text || ""),
                }))
                .filter((m) => m.text);
        } catch (histErr) {
            console.warn("[WHATSAPP BOT] Could not load message history:", histErr?.message);
        }
    }

    try {
        await inboxRef.set(
            {
                aiReplyStatus: reachedAutomationLimit ? "skipped" : (shouldTryAi ? "attempted" : "skipped"),
                aiReplySkipReason: reachedAutomationLimit ? "automation_limit" : (shouldTryAi ? "" : "rules_not_matched"),
                aiReplyAttemptAt: shouldTryAi ? Date.now() : null,
            },
            { merge: true }
        );
        aiResult = shouldTryAi ? await analyzeLeadReplyWithAi({ client, channel, reply, recentMessages }) : null;
        if (aiResult?.reply) {
            body = safeString(aiResult.reply || body);
            currentBotStage = `ai:${safeString(aiResult.nextState || "assist")}`;
            aiReplyStatus = "used";
        } else {
            aiReplyStatus = shouldTryAi ? "not_used" : "skipped";
        }
    } catch (aiError) {
        aiReplyStatus = "error";
        aiReplyError = String(aiError?.message || aiError || "unknown_ai_error");
        console.error("[AI LEAD ASSISTANT] error:", aiError);
        await inboxRef.set(
            {
                aiReplyStatus: "error",
                aiReplyError,
                aiReplyRawOutput: String(aiError?.aiRawOutput || "").slice(0, 1200),
                aiReplyAt: Date.now(),
            },
            { merge: true }
        );
    }
    const markIntroSent = !!reply?.markIntroSent;

    if (!body || !currentBotStage) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "empty_reply",
            language: channel.language,
            marketCountry: channel.marketCountry,
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "empty_reply",
                botReplyAt: Date.now(),
            },
            { merge: true }
        );
        return;
    }

    const lastBotReplyText = safeString(client?.lastBotReplyText || "");
    const lastBotStage = safeString(client?.lastBotStage || "");

    if (lastBotReplyText === body && lastBotStage === currentBotStage) {
        console.log("[WHATSAPP BOT] skipped:", {
            clientId,
            waId,
            reason: "same_reply_as_previous",
            stage: currentBotStage,
            language: channel.language,
            marketCountry: channel.marketCountry,
        });

        await inboxRef.set(
            {
                botReplyStatus: "skipped",
                botReplyReason: "same_reply_as_previous",
                botReplyAt: Date.now(),
                aiReplyStatus,
                aiReplyError,
                aiReplyRawOutput: "",
                aiReplyIntent: safeString(aiResult?.intent || ""),
                aiReplyNextState: safeString(aiResult?.nextState || ""),
                aiReplyModel: safeString(aiResult?.model || ""),
                aiReplyUsage: aiResult?.usage || null,
                automationLimitReached: reachedAutomationLimit,
            },
            { merge: true }
        );
        return;
    }

    const sendResult = await sendWhatsAppText(waId, body, {
        phoneNumberId: channel.phoneNumberId,
    });
    const now = Date.now();
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
            source: "bot_auto",
            stage: currentBotStage,
            aiAssisted: !!aiResult,
            aiIntent: safeString(aiResult?.intent || ""),
            whatsappPhoneNumberId: channel.phoneNumberId,
            language: channel.language,
            marketCountry: channel.marketCountry,
        },
    });

    const clientPatch = {
        lastBotReplyAt: now,
        lastBotReplyText: body,
        lastBotStage: currentBotStage,
        lastOutboundAt: now,
        botReplyCount: safeNumber(client?.botReplyCount, 0) + 1,
        [`botStageCounts.${currentBotStage}`]: safeNumber(client?.botStageCounts?.[currentBotStage], 0) + 1,
    };

    if (reachedAutomationLimit) {
        clientPatch.chatMode = "human";
        clientPatch.botPausedAt = now;
        clientPatch.botPausedBy = safeString(client?.botReactivationActive || "") === "true" || client?.botReactivationActive === true
            ? "reactivation_limit"
            : "automation_limit";
        clientPatch.humanNeededAt = now;
        clientPatch.humanNeededReason = safeString(client?.botReactivationActive || "") === "true" || client?.botReactivationActive === true
            ? "reactivation_limit"
            : "automation_limit";
        clientPatch.botReactivationActive = false;
        clientPatch.botReactivationEndedAt = now;
    }

    if (aiResult) {
        clientPatch.aiLastUsedAt = now;
        clientPatch.aiLastIntent = safeString(aiResult.intent || "");
        clientPatch.aiLastNextState = safeString(aiResult.nextState || "");
        clientPatch.aiLastQualification = safeString(aiResult.qualification || "");
        clientPatch.aiLastModel = safeString(aiResult.model || "");
        clientPatch.aiLastReply = body;
        clientPatch.aiLastUsage = aiResult.usage || null;
        if (aiResult.shouldClose) {
            clientPatch.chatMode = "human";
            clientPatch.botPausedAt = now;
            clientPatch.botPausedBy = "ai_close";
        }
    }

    if (!reachedAutomationLimit && (safeString(client?.botReactivationActive || "") === "true" || client?.botReactivationActive === true)) {
        clientPatch.botReactivationReplyCount = safeNumber(client?.botReactivationReplyCount, 0) + 1;
        clientPatch.lastBotReactivationReplyAt = now;
    }

    if (markIntroSent && !safeNumber(client?.initialIntroSentAt, 0)) {
        clientPatch.initialIntroSentAt = now;
        clientPatch.currentLeadMapsConfirmedAt = 0;
    }

    await clientRef.set(clientPatch, { merge: true });

    await inboxRef.set(
        {
            botReplyStatus: "sent",
            botReplyText: body,
            botReplyAt: now,
            botReplyStage: currentBotStage,
            botReplyMessageId: whatsappMessageId,
            aiReplyStatus,
            aiReplyError,
            aiReplyRawOutput: "",
            aiReplyIntent: safeString(aiResult?.intent || ""),
            aiReplyNextState: safeString(aiResult?.nextState || ""),
            aiReplyModel: safeString(aiResult?.model || ""),
            aiReplyUsage: aiResult?.usage || null,
            automationLimitReached: reachedAutomationLimit,
        },
        { merge: true }
    );

    console.log("[WHATSAPP BOT] sent:", {
        clientId,
        waId,
        stage: currentBotStage,
        language: channel.language,
        marketCountry: channel.marketCountry,
        phoneNumberId: channel.phoneNumberId,
        whatsappMessageId,
    });
}

const upsertLeadAsClient = createUpsertLeadAsClient({
    parseLeadText,
    resolveNextClientName,
    getFinalParseStatus,
});

const processIncomingWhatsappMessage = createProcessIncomingWhatsappMessage({
    looksLikeSystemOrMetaMessage,
    looksLikeGreetingOrInterestText: business.looksLikeGreetingOrInterestText,
    looksLikeBrazilAddress,
    isLikelyBusinessLine: business.isLikelyBusinessLine,
    upsertLeadAsClient,
    maybeReplyToLead,
    getRandomHumanReplyDelayMs: leadState.getRandomHumanReplyDelayMs,
});

exports.onClientCreatedAssigned = onDocumentCreated("clients/{clientId}", async (event) => {
    const clientId = event.params.clientId;
    const after = event.data?.data() || {};

    if (!after.assignedTo) return;

    try {
        await notifyAssignedUser({ clientId, after });
        await notifyAssignedLeadAdmins({ clientId, after });
    } catch (e) {
        console.log("[PUSH] create error:", e);
    }
});

exports.onClientReassigned = onDocumentUpdated("clients/{clientId}", async (event) => {
    const clientId = event.params.clientId;

    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};

    const beforeUid = before.assignedTo || null;
    const afterUid = after.assignedTo || null;

    if (!afterUid || beforeUid === afterUid) return;

    // If takenFromIncompleteAt was just stamped in the same write, the vendor
    // self-assigned from "No verificados" — don't send a "nuevo cliente" notification.
    const beforeTaken = before.takenFromIncompleteAt || null;
    const afterTaken = after.takenFromIncompleteAt || null;
    if (afterTaken && !beforeTaken) return;

    try {
        await notifyAssignedUser({ clientId, after });
        await notifyAssignedLeadAdmins({ clientId, after });
    } catch (e) {
        console.log("[PUSH] update error:", e);
    }
});

/*
MANUAL CHAT
*/

exports.sendManualLeadMessage = onRequest(
    {
        region: "us-central1",
        cors: true,
    },
    async (req, res) => {
        try {
            if (req.method !== "POST") {
                res.status(405).json({ ok: false, error: "method_not_allowed" });
                return;
            }

            const { uid, user } = await requireActivePanelUser(req);

            const body = req.body || {};
            const clientId = String(body?.clientId || "").trim();
            const text = String(body?.text || "").trim();
            const markHumanTakeover = body?.markHumanTakeover !== false;

            if (!clientId) {
                res.status(400).json({ ok: false, error: "missing_client_id" });
                return;
            }

            if (!text) {
                res.status(400).json({ ok: false, error: "missing_text" });
                return;
            }

            await assertCanSendManualMessage({ uid, user, clientId });

            const result = await sendManualWhatsAppMessage({
                clientId,
                adminUserId: uid,
                body: text,
                markHumanTakeover,
            });

            res.status(200).json(result);
        } catch (error) {
            const status = Number(error?.statusCode) || 500;
            console.error("[WHATSAPP MANUAL] send error:", error);
            res.status(status).json({
                ok: false,
                error: String(error?.message || "manual_send_failed"),
            });
        }
    }
);

exports.resumeBotLead = onRequest(
    {
        region: "us-central1",
        cors: true,
    },
    async (req, res) => {
        try {
            if (req.method !== "POST") {
                res.status(405).json({ ok: false, error: "method_not_allowed" });
                return;
            }

            const { uid } = await requireAdminUser(req);

            const body = req.body || {};
            const clientId = String(body?.clientId || "").trim();

            if (!clientId) {
                res.status(400).json({ ok: false, error: "missing_client_id" });
                return;
            }

            const result = await resumeBotForClient({
                clientId,
                adminUserId: uid,
            });

            res.status(200).json(result);
        } catch (error) {
            const status = Number(error?.statusCode) || 500;
            console.error("[WHATSAPP MANUAL] resume bot error:", error);
            res.status(status).json({
                ok: false,
                error: String(error?.message || "resume_bot_failed"),
            });
        }
    }
);

/*
REMINDER AUTOMÁTICO
Revisa leads incompletos antes de que cierre la ventana de 24h
*/

exports.reminderMissingInfo = onSchedule(
    {
        schedule: "every 30 minutes",
        region: "us-central1",
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    createReminderMissingInfoJob({
        hoursBeforeDeadline: 5,
        maxClientsPerRun: 300,
        maxRemindersPerClient: 2,
    })
);
exports.createManagedUser = createManagedUser;
exports.updateManagedUserAuth = updateManagedUserAuth;
exports.whatsappWebhook = onRequest(
    {
        region: "us-central1",
        cors: true,
        secrets: [OPENAI_API_KEY],
    },
    async (req, res) => {
        try {
            if (req.method === "GET") {
                const mode = req.query["hub.mode"];
                const token = req.query["hub.verify_token"];
                const challenge = req.query["hub.challenge"];

                const expectedToken = WHATSAPP_VERIFY_TOKEN.value();

                if (mode === "subscribe" && token === expectedToken) {
                    console.log("[WHATSAPP] webhook verified");
                    res.status(200).send(challenge);
                    return;
                }

                console.log("[WHATSAPP] verification failed");
                res.status(403).send("Forbidden");
                return;
            }

            if (req.method !== "POST") {
                res.status(405).send("Method Not Allowed");
                return;
            }

            const { safeString } = require("./src/utils/text");

            const body = req.body || {};
            const entries = Array.isArray(body?.entry) ? body.entry : [];

            for (const entry of entries) {
                const changes = Array.isArray(entry?.changes) ? entry.changes : [];

                for (const change of changes) {
                    const field = safeString(change?.field);
                    const value = change?.value || {};

                    if (field !== "messages") continue;

                    await processIncomingWhatsappMessage(value);
                }
            }

            res.status(200).send("EVENT_RECEIVED");
        } catch (error) {
            console.error("[WHATSAPP] webhook fatal error:", error);
            res.status(500).send("internal_error");
        }
    }
);
