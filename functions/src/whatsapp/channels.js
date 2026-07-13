const {
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_PHONE_NUMBER_ID_PA,
    WHATSAPP_PHONE_NUMBER_ID_AR,
} = require("../config/params");
const { safeString } = require("../utils/text");

const FALLBACK_PANAMA_PHONE_NUMBER_ID = "1105131466013890";
const FALLBACK_ARGENTINA_PHONE_NUMBER_ID = "1217681158095488";

function buildChannel({
    phoneNumberId,
    displayPhoneNumber = "",
    marketCountry,
    language,
    countryNormalized,
    countryLabel,
}) {
    return {
        phoneNumberId: safeString(phoneNumberId),
        displayPhoneNumber: safeString(displayPhoneNumber),
        marketCountry,
        language,
        countryNormalized,
        countryLabel,
    };
}

function getBrazilPhoneNumberId() {
    return safeString(WHATSAPP_PHONE_NUMBER_ID.value());
}

function getPanamaPhoneNumberId() {
    return safeString(WHATSAPP_PHONE_NUMBER_ID_PA.value()) || FALLBACK_PANAMA_PHONE_NUMBER_ID;
}

function getArgentinaPhoneNumberId() {
    return safeString(WHATSAPP_PHONE_NUMBER_ID_AR.value()) || FALLBACK_ARGENTINA_PHONE_NUMBER_ID;
}

function getDefaultWhatsappChannel() {
    return buildChannel({
        phoneNumberId: getBrazilPhoneNumberId(),
        marketCountry: "BR",
        language: "pt-BR",
        countryNormalized: "brasil",
        countryLabel: "Brasil",
    });
}

function getPanamaWhatsappChannel(displayPhoneNumber = "") {
    return buildChannel({
        phoneNumberId: getPanamaPhoneNumberId(),
        displayPhoneNumber,
        marketCountry: "PA",
        language: "es-PA",
        countryNormalized: "panama",
        countryLabel: "Panama",
    });
}

function getArgentinaWhatsappChannel(displayPhoneNumber = "") {
    return buildChannel({
        phoneNumberId: getArgentinaPhoneNumberId(),
        displayPhoneNumber,
        marketCountry: "AR",
        language: "es-AR",
        countryNormalized: "argentina",
        countryLabel: "Argentina",
    });
}

function getWhatsappChannelByPhoneNumberId(phoneNumberId, displayPhoneNumber = "") {
    const id = safeString(phoneNumberId);

    if (id && id === getPanamaPhoneNumberId()) {
        return getPanamaWhatsappChannel(displayPhoneNumber);
    }

    if (id && id === getArgentinaPhoneNumberId()) {
        return getArgentinaWhatsappChannel(displayPhoneNumber);
    }

    const brId = getBrazilPhoneNumberId();
    if (!id || !brId || id === brId) {
        return buildChannel({
            ...getDefaultWhatsappChannel(),
            phoneNumberId: id || brId,
            displayPhoneNumber,
        });
    }

    return buildChannel({
        ...getDefaultWhatsappChannel(),
        phoneNumberId: id,
        displayPhoneNumber,
    });
}

function getWhatsappChannelFromMetadata(metadata) {
    return getWhatsappChannelByPhoneNumberId(
        metadata?.phone_number_id,
        metadata?.display_phone_number
    );
}

function getWhatsappChannelFromClient(client) {
    const id = safeString(client?.whatsappPhoneNumberId || "");
    const marketCountry = safeString(client?.marketCountry || "");

    if (id) {
        return getWhatsappChannelByPhoneNumberId(id);
    }

    if (marketCountry === "PA") {
        return getPanamaWhatsappChannel();
    }

    if (marketCountry === "AR") {
        return getArgentinaWhatsappChannel();
    }

    return getDefaultWhatsappChannel();
}

module.exports = {
    FALLBACK_PANAMA_PHONE_NUMBER_ID,
    FALLBACK_ARGENTINA_PHONE_NUMBER_ID,
    getPanamaPhoneNumberId,
    getArgentinaPhoneNumberId,
    getDefaultWhatsappChannel,
    getPanamaWhatsappChannel,
    getArgentinaWhatsappChannel,
    getWhatsappChannelByPhoneNumberId,
    getWhatsappChannelFromMetadata,
    getWhatsappChannelFromClient,
};
