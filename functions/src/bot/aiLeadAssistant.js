const { OPENAI_API_KEY } = require("../config/params");
const { safeString, safeNumber } = require("../utils/text");

const AI_MODEL = "gpt-5-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_BOT_REPLIES_PER_LEAD = 8;
const MAX_MISSING_MAPS_REPLIES = 4;
const MAX_MISSING_BUSINESS_REPLIES = 3;
const REACTIVATION_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_REACTIVATION_REPLIES = 2;

function countStage(client, fragment) {
    const counters = client?.botStageCounts;
    if (!counters || typeof counters !== "object") return 0;

    return Object.entries(counters).reduce((total, [key, value]) => {
        if (!String(key).includes(fragment)) return total;
        const n = Number(value);
        return Number.isFinite(n) ? total + n : total;
    }, 0);
}

function shouldTryAiLeadAssistant({ client, reply }) {
    const stage = safeString(reply?.stage || "");
    const lastText = safeString(client?.lastInboundText || "");
    const hasBusiness = !!safeString(client?.business || client?.businessRaw || "");
    const hasMaps = !!safeString(client?.mapsUrl || "") || safeNumber(client?.currentLeadMapsConfirmedAt, 0) > 0;
    const isQuestionLike =
        lastText.includes("?") ||
        /\b(onde|como|quanto|qual|quais|porque|por que|atiende|atienden|donde|como|cuanto|cual|sirve|serve|atende|atendem)\b/i.test(lastText);

    if (!lastText) return false;
    if (safeString(client?.aiDisabled || "") === "true") return false;
    if (safeString(client?.leadQuality || "") === "not_suitable") return false;
    if (stage === "final" || stage === "final:not_suitable") return false;

    const botReplyCount = safeNumber(client?.botReplyCount, 0);
    if (botReplyCount >= MAX_BOT_REPLIES_PER_LEAD) return true;

    if (stage.includes("maps") && countStage(client, "maps") >= MAX_MISSING_MAPS_REPLIES) return true;
    if (stage.includes("business") && countStage(client, "business") >= MAX_MISSING_BUSINESS_REPLIES) return true;
    if (!(hasBusiness && hasMaps) && isQuestionLike) return true;

    return (
        stage.includes("fallback") ||
        stage.includes("generic_question") ||
        stage.includes("amount") ||
        stage.includes("coverage") ||
        stage.includes("written_address") ||
        safeString(client?.businessQuality || "") === "review"
    );
}

function shouldStopAutomatedConversation(client) {
    if (safeString(client?.botReactivationActive || "") === "true" || client?.botReactivationActive === true) {
        return safeNumber(client?.botReactivationReplyCount, 0) >= MAX_REACTIVATION_REPLIES;
    }

    const botReplyCount = safeNumber(client?.botReplyCount, 0);
    if (botReplyCount >= MAX_BOT_REPLIES_PER_LEAD) return true;
    if (countStage(client, "maps") >= MAX_MISSING_MAPS_REPLIES + 1) return true;
    if (countStage(client, "business") >= MAX_MISSING_BUSINESS_REPLIES + 1) return true;
    return false;
}

function canReactivateAutomation(client, now = Date.now()) {
    if (safeString(client?.chatMode || "bot") !== "human") return false;
    if (safeString(client?.botPausedBy || "") !== "automation_limit") return false;
    if (safeString(client?.assignedTo || "")) return false;
    if (!["incomplete", "pending_review"].includes(safeString(client?.verificationStatus || ""))) return false;

    const pausedAt = safeNumber(client?.botPausedAt, 0);
    if (!pausedAt || now - pausedAt < REACTIVATION_AFTER_MS) return false;

    const reactivationCount = safeNumber(client?.botReactivationCount, 0);
    if (reactivationCount >= 3) return false;

    return true;
}

function buildAutomationLimitReply({ client, channel }) {
    const isSpanish = safeString(channel?.language || "").startsWith("es");
    const hasBusiness = !!safeString(client?.business || client?.businessRaw || "");
    const hasMaps = !!safeString(client?.mapsUrl || "") || safeNumber(client?.currentLeadMapsConfirmedAt, 0) > 0;

    if (isSpanish) {
        if (safeString(client?.botReactivationActive || "") === "true" || client?.botReactivationActive === true) {
            return "Gracias por volver a escribir. Para no insistir demasiado, dejaré tu conversación pendiente para que una persona del equipo la revise.";
        }
        if (!hasBusiness && !hasMaps) {
            return "Gracias por tu tiempo. Para evitar insistir demasiado, dejaré tu conversación pendiente para revisión. Si deseas continuar, envía el tipo de negocio y la ubicación de Google Maps.";
        }
        if (!hasBusiness) {
            return "Gracias por tu tiempo. Dejaré tu conversación pendiente para revisión. Si deseas continuar, envía el tipo de negocio.";
        }
        if (!hasMaps) {
            return "Gracias por tu tiempo. Dejaré tu conversación pendiente para revisión. Si deseas continuar, envía la ubicación de Google Maps del negocio.";
        }
        return "Gracias por la información. Dejaré tu conversación para que una persona del equipo la revise.";
    }

    if (safeString(client?.botReactivationActive || "") === "true" || client?.botReactivationActive === true) {
        return "Obrigado por voltar a escrever. Para nÃ£o insistir demais, vou deixar sua conversa pendente para uma pessoa da equipe revisar.";
    }

    if (!hasBusiness && !hasMaps) {
        return "Obrigado pelo seu tempo. Para evitar insistir demais, vou deixar sua conversa pendente para revisÃ£o. Se quiser continuar, envie o tipo de comÃ©rcio e a localizaÃ§Ã£o no Google Maps.";
    }
    if (!hasBusiness) {
        return "Obrigado pelo seu tempo. Vou deixar sua conversa pendente para revisÃ£o. Se quiser continuar, envie o tipo de comÃ©rcio.";
    }
    if (!hasMaps) {
        return "Obrigado pelo seu tempo. Vou deixar sua conversa pendente para revisÃ£o. Se quiser continuar, envie a localizaÃ§Ã£o do comÃ©rcio no Google Maps.";
    }
    return "Obrigado pelas informaÃ§Ãµes. Vou deixar sua conversa para uma pessoa da equipe revisar.";
}

function languageName(language) {
    return safeString(language || "").startsWith("es") ? "Spanish" : "Portuguese";
}

function buildPrompt({ client, channel, reply }) {
    const targetLanguage = languageName(channel?.language);
    return [
        `You are TrackGo's controlled assistant for microcredit leads. Reply in ${targetLanguage}.`,
        "TrackGo captures WhatsApp leads from Meta campaigns and needs business type plus Google Maps location before assigning to a seller.",
        "You must be brief and helpful.",
        "Mention you are an automatic assistant only if the client asks, if this is the first bot reply, or if you are explaining why information is needed.",
        "Do not repeat that you are an automatic assistant in every message.",
        "Never promise approval, exact values, interest rates, or document requirements.",
        "Do not ask for sensitive documents.",
        "Delivery, home-based commerce, informal stands, food trucks, and small shops can continue if they have active commerce.",
        "If the client is not interested or asks to stop, close politely.",
        "If information is missing, ask only for the most important next missing item.",
        "Prefer Google Maps location over written address; if they sent only written address, ask for Google Maps location.",
        "",
        "Current lead state:",
        JSON.stringify({
            language: channel?.language || "pt-BR",
            marketCountry: channel?.marketCountry || "BR",
            name: safeString(client?.name || ""),
            business: safeString(client?.business || client?.businessRaw || ""),
            address: safeString(client?.address || ""),
            mapsUrl: safeString(client?.mapsUrl || ""),
            parseStatus: safeString(client?.parseStatus || ""),
            verificationStatus: safeString(client?.verificationStatus || ""),
            lastInboundText: safeString(client?.lastInboundText || ""),
            currentBotStage: safeString(reply?.stage || ""),
            currentBotReply: safeString(reply?.body || ""),
            botReplyCount: safeNumber(client?.botReplyCount, 0),
            mapsRequests: countStage(client, "maps"),
            businessRequests: countStage(client, "business"),
        }),
        "",
        "Return only valid JSON with this shape:",
        JSON.stringify({
            intent: "provided_business | provided_location | asks_amount | asks_how_it_works | asks_coverage | not_interested | unclear | other",
            extracted: {
                business: "string or empty",
                address: "string or empty",
                mapsUrl: "string or empty",
            },
            qualification: "qualified | incomplete | not_suitable | unknown",
            nextState: "asking_business | asking_location | answering_question | ready_to_assign | closed_not_interested | human_needed",
            shouldUseAiReply: true,
            shouldClose: false,
            reply: "short WhatsApp-ready message",
        }),
    ].join("\n");
}

function extractJsonText(data) {
    if (typeof data?.output_text === "string") return data.output_text;

    const chunks = [];
    for (const item of Array.isArray(data?.output) ? data.output : []) {
        for (const content of Array.isArray(item?.content) ? item.content : []) {
            if (typeof content?.text === "string") chunks.push(content.text);
            if (typeof content?.output_text === "string") chunks.push(content.output_text);
            if (typeof content?.json === "object") chunks.push(JSON.stringify(content.json));
        }
    }
    return chunks.join("\n").trim();
}

function parseAiPayload(text) {
    const raw = safeString(text || "");
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return JSON.parse(raw.slice(start, end + 1));
        }
    }

    return null;
}

function sanitizeAiResult(payload) {
    if (!payload || typeof payload !== "object") return null;

    const reply = safeString(payload.reply || "");
    if (!reply || reply.length > 700) return null;

    return {
        intent: safeString(payload.intent || "unknown") || "unknown",
        extracted: {
            business: safeString(payload.extracted?.business || ""),
            address: safeString(payload.extracted?.address || ""),
            mapsUrl: safeString(payload.extracted?.mapsUrl || ""),
        },
        qualification: safeString(payload.qualification || "unknown") || "unknown",
        nextState: safeString(payload.nextState || "answering_question") || "answering_question",
        shouldUseAiReply: payload.shouldUseAiReply !== false,
        shouldClose: payload.shouldClose === true,
        reply,
    };
}

async function analyzeLeadReplyWithAi({ client, channel, reply }) {
    if (!shouldTryAiLeadAssistant({ client, reply })) return null;

    const key = OPENAI_API_KEY.value();
    if (!key) return null;

    const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: AI_MODEL,
            input: buildPrompt({ client, channel, reply }),
            reasoning: {
                effort: "minimal",
            },
            text: {
                format: {
                    type: "json_schema",
                    name: "trackgo_lead_assistant",
                    strict: true,
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            intent: {
                                type: "string",
                                enum: [
                                    "provided_business",
                                    "provided_location",
                                    "asks_amount",
                                    "asks_how_it_works",
                                    "asks_coverage",
                                    "not_interested",
                                    "unclear",
                                    "other",
                                ],
                            },
                            extracted: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                    business: { type: "string" },
                                    address: { type: "string" },
                                    mapsUrl: { type: "string" },
                                },
                                required: ["business", "address", "mapsUrl"],
                            },
                            qualification: {
                                type: "string",
                                enum: ["qualified", "incomplete", "not_suitable", "unknown"],
                            },
                            nextState: {
                                type: "string",
                                enum: [
                                    "asking_business",
                                    "asking_location",
                                    "answering_question",
                                    "ready_to_assign",
                                    "closed_not_interested",
                                    "human_needed",
                                ],
                            },
                            shouldUseAiReply: { type: "boolean" },
                            shouldClose: { type: "boolean" },
                            reply: { type: "string" },
                        },
                        required: [
                            "intent",
                            "extracted",
                            "qualification",
                            "nextState",
                            "shouldUseAiReply",
                            "shouldClose",
                            "reply",
                        ],
                    },
                },
            },
            max_output_tokens: 1200,
        }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(safeString(data?.error?.message || `openai_${response.status}`));
        err.statusCode = response.status;
        throw err;
    }

    const outputText = extractJsonText(data);
    const parsed = sanitizeAiResult(parseAiPayload(outputText));
    if (!parsed) {
        const err = new Error("ai_invalid_json_response");
        err.aiRawOutput = safeString(outputText || JSON.stringify({
            status: data?.status || "",
            incomplete_details: data?.incomplete_details || null,
            output: data?.output || null,
            error: data?.error || null,
        })).slice(0, 1200);
        throw err;
    }

    if (!parsed.shouldUseAiReply) return null;

    return {
        ...parsed,
        model: AI_MODEL,
        usage: data?.usage || null,
    };
}

module.exports = {
    OPENAI_API_KEY,
    analyzeLeadReplyWithAi,
    buildAutomationLimitReply,
    canReactivateAutomation,
    shouldStopAutomatedConversation,
    shouldTryAiLeadAssistant,
};
