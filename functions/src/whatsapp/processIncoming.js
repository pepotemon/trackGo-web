const { db } = require("../core/firebase");
const {
    safeString,
    normalizePhone,
    cleanupExtractedText,
} = require("../utils/text");
const {
    dayKeyFromMs,
    roundCoord,
    hasValidCoords,
    buildGoogleMapsUrlFromCoords,
    extractGoogleMapsUrlFromText,
    looksLikeMapsUrl,
    isGoogleMapsStaticAssetUrl,
} = require("../utils/geo");
const { appendClientMessage } = require("./manualReply");
const { autoAssignLead } = require("../assignments/autoAssignLead");
const { getWhatsappChannelFromMetadata } = require("./channels");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickInboundOriginalMapsUrl({ textBody, locationData }) {
    const textMapsUrl = extractGoogleMapsUrlFromText(textBody);

    if (
        textMapsUrl &&
        looksLikeMapsUrl(textMapsUrl) &&
        !isGoogleMapsStaticAssetUrl(textMapsUrl)
    ) {
        return textMapsUrl;
    }

    if (
        locationData?.mapsUrl &&
        looksLikeMapsUrl(locationData.mapsUrl) &&
        !isGoogleMapsStaticAssetUrl(locationData.mapsUrl)
    ) {
        return locationData.mapsUrl;
    }

    if (hasValidCoords(locationData?.lat, locationData?.lng)) {
        return buildGoogleMapsUrlFromCoords(locationData.lat, locationData.lng);
    }

    return "";
}

function extractMetaReferral(message) {
    const referral = message?.referral || message?.context?.referral || null;
    if (!referral || typeof referral !== "object") return null;

    const sourceId = safeString(referral.source_id || referral.sourceId || referral.id || "");
    const sourceUrl = safeString(referral.source_url || referral.sourceUrl || "");
    const headline = safeString(referral.headline || "");
    const body = safeString(referral.body || "");

    if (!sourceId && !sourceUrl && !headline && !body) return null;

    return {
        sourceId,
        sourceUrl,
        headline,
        body,
        mediaType: safeString(referral.media_type || referral.mediaType || ""),
        sourceType: safeString(referral.source_type || referral.sourceType || ""),
    };
}

async function findCityByMetaSourceId(sourceId) {
    const cleanSourceId = safeString(sourceId || "");
    if (!cleanSourceId) return null;

    const queries = [
        db.collection("cities").where("adIds", "array-contains", cleanSourceId).limit(1),
        db.collection("cities").where("campaignId", "==", cleanSourceId).limit(1),
        db.collection("cities").where("activeCampaignId", "==", cleanSourceId).limit(1),
        db.collection("cities").where("baseCampaignId", "==", cleanSourceId).limit(1),
    ];

    for (const cityQuery of queries) {
        const snap = await cityQuery.get();
        if (!snap.empty) return snap.docs[0];
    }

    return null;
}

async function resolveLeadAcquisitionFromReferral(referral) {
    if (!referral) return {};

    const sourceId = safeString(referral.sourceId || "");
    const citySnap = await findCityByMetaSourceId(sourceId).catch((error) => {
        console.log("[WHATSAPP] referral city lookup error:", error?.message || error);
        return null;
    });
    const city = citySnap?.exists ? citySnap.data() || {} : {};

    return {
        leadAcquisitionSource: "meta_referral",
        leadAcquisitionSourceId: sourceId,
        leadAcquisitionSourceUrl: safeString(referral.sourceUrl || ""),
        leadAcquisitionHeadline: safeString(referral.headline || ""),
        leadAcquisitionBody: safeString(referral.body || ""),
        leadAcquisitionMediaType: safeString(referral.mediaType || ""),
        leadAcquisitionSourceType: safeString(referral.sourceType || ""),
        leadAcquisitionCityId: citySnap?.id || "",
        leadAcquisitionCityLabel: safeString(city.name || city.cityName || citySnap?.id || ""),
        leadAcquisitionCampaignId: safeString(city.activeCampaignId || city.campaignId || city.baseCampaignId || ""),
        leadAcquisitionResolvedAt: Date.now(),
    };
}

async function tryAutoAssignClientById(clientId, attempt = 1) {
    if (!clientId) return;

    const clientRef = db.collection("clients").doc(clientId);
    const snap = await clientRef.get();
    if (!snap.exists) return;

    const client = snap.data() || {};

    if (safeString(client.assignedTo)) {
        console.log("[AUTO ASSIGN] skipped already assigned:", {
            clientId,
            assignedTo: safeString(client.assignedTo),
            attempt,
        });
        return;
    }

    console.log("[AUTO ASSIGN] candidate:", {
        clientId,
        attempt,
        parseStatus: safeString(client.parseStatus || ""),
        verificationStatus: safeString(client.verificationStatus || ""),
        geoAdminCityLabel: safeString(client.geoAdminCityLabel || ""),
        geoAdminCityNormalized: safeString(client.geoAdminCityNormalized || ""),
        geoCityLabel: safeString(client.geoCityLabel || ""),
        geoCityNormalized: safeString(client.geoCityNormalized || ""),
        geoNearestHubLabel: safeString(client.geoNearestHubLabel || ""),
    });

    await autoAssignLead({
        id: clientId,
        ...client,
    });
}

function createProcessIncomingWhatsappMessage({
    looksLikeSystemOrMetaMessage,
    looksLikeGreetingOrInterestText,
    looksLikeBrazilAddress,
    isLikelyBusinessLine,
    upsertLeadAsClient,
    maybeReplyToLead,
    getRandomHumanReplyDelayMs,
}) {
    return async function processIncomingWhatsappMessage(changeValue) {
        const contacts = Array.isArray(changeValue?.contacts) ? changeValue.contacts : [];
        const messages = Array.isArray(changeValue?.messages) ? changeValue.messages : [];
        const channel = getWhatsappChannelFromMetadata(changeValue?.metadata || {});

        for (const msg of messages) {
            const msgType = safeString(msg?.type);
            if (msgType !== "text" && msgType !== "location") continue;

            const messageId = safeString(msg?.id);
            const waId = normalizePhone(msg?.from || "");

            if (!waId || !messageId) continue;

            const inboxRef = db.collection("incomingLeads").doc(messageId);

            // Atomically claim this messageId to prevent duplicate processing
            // (Meta re-delivers webhooks if the function takes > ~5s to acknowledge)
            let claimed = false;
            try {
                await db.runTransaction(async (t) => {
                    const snap = await t.get(inboxRef);
                    if (snap.exists) {
                        const d = snap.data() || {};
                        if (d.status === "processed" || d.status === "processing") return;
                    }
                    t.set(inboxRef, { id: messageId, status: "processing", claimedAt: Date.now() }, { merge: true });
                    claimed = true;
                });
            } catch (txErr) {
                console.warn("[WHATSAPP] claim transaction failed for:", messageId, txErr?.message);
            }
            if (!claimed) {
                console.log("[WHATSAPP] duplicated inbound skipped:", messageId);
                continue;
            }

            const contact =
                contacts.find((c) => normalizePhone(c?.wa_id || "") === waId) || {};
            const profileName = safeString(contact?.profile?.name);

            let textBody = "";
            let locationData = null;

            if (msgType === "text") {
                textBody = safeString(msg?.text?.body);
                if (!textBody) continue;
            }

            if (msgType === "location") {
                const lat = roundCoord(msg?.location?.latitude);
                const lng = roundCoord(msg?.location?.longitude);
                const address = cleanupExtractedText(msg?.location?.address || "");
                const name = cleanupExtractedText(msg?.location?.name || "");
                const mapsUrl = hasValidCoords(lat, lng)
                    ? buildGoogleMapsUrlFromCoords(lat, lng)
                    : "";

                locationData = {
                    lat,
                    lng,
                    address,
                    name,
                    mapsUrl,
                };

                textBody = [
                    name ? `Local: ${name}` : "",
                    address ? `Endereço: ${address}` : "",
                    mapsUrl ? `Maps: ${mapsUrl}` : "",
                ]
                    .filter(Boolean)
                    .join(" | ");
            }

            const now = Date.now();
            const originalMapsUrl = pickInboundOriginalMapsUrl({
                textBody,
                locationData,
            });
            const metaReferral = extractMetaReferral(msg);
            const leadAcquisition = await resolveLeadAcquisitionFromReferral(metaReferral);

            await inboxRef.set(
                {
                    id: messageId,
                    source: "whatsapp_meta",
                    channel: "whatsapp",
                    phone: waId,
                    waId,
                    profileName: profileName || "",
                    rawText: textBody || "",
                    messageType: msgType,
                    createdAt: now,
                    dayKey: dayKeyFromMs(now),
                    parseStatus: "processing",
                    status: "processing",

                    mapsUrl: originalMapsUrl,
                    originalMapsUrl,
                    resolvedMapsUrl: "",
                    mapsResolveSource: "",
                    mapsResolveQuery: "",

                    lat: locationData?.lat ?? null,
                    lng: locationData?.lng ?? null,
                    locationAddress: locationData?.address || "",
                    locationName: locationData?.name || "",

                    whatsappPhoneNumberId: channel.phoneNumberId,
                    whatsappDisplayPhoneNumber: channel.displayPhoneNumber,
                    marketCountry: channel.marketCountry,
                    language: channel.language,
                    ...leadAcquisition,
                },
                { merge: true }
            );

            try {
                if (msgType === "text") {
                    const isSystemMessage = looksLikeSystemOrMetaMessage(
                        textBody,
                        profileName,
                        waId
                    );

                    if (isSystemMessage) {
                        await inboxRef.set(
                            {
                                status: "processed",
                                result: "ignored",
                                ignored: true,
                                ignoreReason: "system_message",
                                processedAt: Date.now(),
                            },
                            { merge: true }
                        );

                        console.log("[WHATSAPP] ignored system message:", {
                            messageId,
                            waId,
                            profileName,
                        });
                        continue;
                    }
                }

                const isGreetingOnly =
                    msgType === "text" &&
                    !looksLikeBrazilAddress(textBody) &&
                    !isLikelyBusinessLine(textBody) &&
                    !extractGoogleMapsUrlFromText(textBody) &&
                    looksLikeGreetingOrInterestText(textBody);

                const result = await upsertLeadAsClient({
                    phone: waId,
                    profileName,
                    rawText: textBody,
                    inboxRef,
                    messageId,
                    contactWaId: waId,
                    locationData,
                    originalMapsUrl,
                    channel,
                    leadAcquisition,
                });

                if (result?.clientId) {
                    await appendClientMessage({
                        clientId: result.clientId,
                        direction: "inbound",
                        senderType: "client",
                        senderId: waId,
                        text: textBody,
                        messageType: msgType,
                        whatsappMessageId: messageId,
                        status: "received",
                        meta: {
                            source: "whatsapp_meta",
                            profileName: profileName || "",
                            locationCaptured: !!locationData,
                            lat: locationData?.lat ?? null,
                            lng: locationData?.lng ?? null,

                            originalMapsUrl: originalMapsUrl || "",
                            resolvedMapsUrl: safeString(result?.mergedClient?.resolvedMapsUrl || ""),
                            mapsUrl: safeString(result?.mergedClient?.mapsUrl || ""),
                            mapsResolveSource: safeString(result?.mergedClient?.mapsResolveSource || ""),
                            mapsResolveQuery: safeString(result?.mergedClient?.mapsResolveQuery || ""),
                            whatsappPhoneNumberId: channel.phoneNumberId,
                            whatsappDisplayPhoneNumber: channel.displayPhoneNumber,
                            marketCountry: channel.marketCountry,
                            language: channel.language,
                            ...leadAcquisition,
                        },
                    });
                }

                if (result?.clientId) {
                    try {
                        await tryAutoAssignClientById(result.clientId, 1);

                        const clientSnapAfterFirstTry = await db
                            .collection("clients")
                            .doc(result.clientId)
                            .get();

                        const clientAfterFirstTry = clientSnapAfterFirstTry.exists
                            ? clientSnapAfterFirstTry.data() || {}
                            : {};

                        const stillUnassigned = !safeString(clientAfterFirstTry.assignedTo || "");
                        const looksReadyNow =
                            safeString(clientAfterFirstTry.parseStatus || "") === "ready" &&
                            ["pending_review", "verified"].includes(
                                safeString(clientAfterFirstTry.verificationStatus || "")
                            );

                        if (stillUnassigned && looksReadyNow) {
                            await sleep(350);
                            await tryAutoAssignClientById(result.clientId, 2);
                        }
                    } catch (autoAssignError) {
                        console.error("[AUTO ASSIGN] error:", autoAssignError);
                    }
                }

                await inboxRef.set(
                    {
                        status: "processed",
                        result: result?.result || "updated_existing",
                        clientId: result?.clientId || "",
                        parseStatus: result?.parseStatus || "partial",
                        processedAt: Date.now(),
                        greetingDetected: isGreetingOnly,

                        parsedName: cleanupExtractedText(result?.mergedClient?.name || ""),
                        parsedAddress: cleanupExtractedText(
                            result?.mergedClient?.address || ""
                        ),
                        parsedBusiness: cleanupExtractedText(
                            result?.mergedClient?.business || ""
                        ),
                        parsedBusinessRaw: cleanupExtractedText(
                            result?.mergedClient?.businessRaw || ""
                        ),
                        businessQuality: safeString(
                            result?.mergedClient?.businessQuality || ""
                        ),
                        businessFlags: Array.isArray(result?.mergedClient?.businessFlags)
                            ? result.mergedClient.businessFlags
                            : [],
                        profileFlags: Array.isArray(result?.mergedClient?.profileFlags)
                            ? result.mergedClient.profileFlags
                            : [],
                        profileType: safeString(result?.mergedClient?.profileType || ""),
                        leadQuality: safeString(result?.mergedClient?.leadQuality || ""),
                        notSuitableReason: safeString(
                            result?.mergedClient?.notSuitableReason || ""
                        ),
                        verificationStatus: safeString(
                            result?.mergedClient?.verificationStatus || ""
                        ),

                        mapsUrl: safeString(result?.mergedClient?.mapsUrl || ""),
                        originalMapsUrl: safeString(
                            result?.mergedClient?.originalMapsUrl || originalMapsUrl || ""
                        ),
                        resolvedMapsUrl: safeString(result?.mergedClient?.resolvedMapsUrl || ""),
                        mapsResolveSource: safeString(
                            result?.mergedClient?.mapsResolveSource || ""
                        ),
                        mapsResolveQuery: safeString(
                            result?.mergedClient?.mapsResolveQuery || ""
                        ),

                        lat: result?.mergedClient?.lat ?? null,
                        lng: result?.mergedClient?.lng ?? null,

                        whatsappPhoneNumberId: channel.phoneNumberId,
                        whatsappDisplayPhoneNumber: channel.displayPhoneNumber,
                        marketCountry: channel.marketCountry,
                        language: channel.language,
                        ...leadAcquisition,
                    },
                    { merge: true }
                );

                try {
                    const delayMs =
                        typeof getRandomHumanReplyDelayMs === "function"
                            ? getRandomHumanReplyDelayMs()
                            : 12000;

                    await inboxRef.set(
                        {
                            botReplyPlannedDelayMs: delayMs,
                        },
                        { merge: true }
                    );

                    await sleep(delayMs);

                    // Acquire per-client lock to prevent concurrent bot replies.
                    // Multiple messages from the same client can arrive within seconds;
                    // all instances sleep concurrently and wake up before any of them
                    // has written lastBotReplyAt, so the cooldown check in shouldSendBotReply
                    // would pass for all of them simultaneously.
                    let replyGranted = false;
                    try {
                        const clientRef = db.collection("clients").doc(result.clientId);
                        await db.runTransaction(async (t) => {
                            const snap = await t.get(clientRef);
                            if (!snap.exists) return;
                            const d = snap.data() || {};
                            const mostRecent = Math.max(d.botReplyClaimedAt || 0, d.lastBotReplyAt || 0);
                            if (Date.now() - mostRecent < 30_000) return;
                            t.update(clientRef, { botReplyClaimedAt: Date.now() });
                            replyGranted = true;
                        });
                    } catch (lockErr) {
                        console.warn("[WHATSAPP BOT] lock transaction failed:", result.clientId, lockErr?.message);
                    }

                    if (!replyGranted) {
                        console.log("[WHATSAPP BOT] reply skipped - concurrent reply for client:", result.clientId);
                        await inboxRef.set(
                            { botReplyStatus: "skipped", botReplyReason: "concurrent_reply", botReplyAt: Date.now() },
                            { merge: true }
                        );
                    } else {
                        await maybeReplyToLead({
                            clientId: result.clientId,
                            waId,
                            messageType: msgType,
                            inboxRef,
                        });
                    }
                } catch (botError) {
                    console.error("[WHATSAPP BOT] reply error:", botError);

                    await inboxRef.set(
                        {
                            botReplyStatus: "error",
                            botReplyError: String(
                                botError?.message || botError || "unknown_bot_error"
                            ),
                            botReplyAt: Date.now(),
                        },
                        { merge: true }
                    );
                }

                console.log("[WHATSAPP] processed message:", {
                    messageId,
                    waId,
                    messageType: msgType,
                    result: result?.result,
                    clientId: result?.clientId,
                    phoneNumberId: channel.phoneNumberId,
                    marketCountry: channel.marketCountry,
                    language: channel.language,
                });
            } catch (error) {
                console.error("[WHATSAPP] process error:", error);

                await inboxRef.set(
                    {
                        status: "error",
                        error: String(error?.message || error || "unknown_error"),
                        processedAt: Date.now(),
                    },
                    { merge: true }
                );
            }
        }
    };
}

module.exports = {
    createProcessIncomingWhatsappMessage,
};
