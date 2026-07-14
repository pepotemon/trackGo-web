const {
    safeString,
    cleanupExtractedText,
    normalizeLooseText,
} = require("./text");
const {
    roundCoord,
    hasValidCoords,
    looksLikeMapsUrl,
    isGoogleMapsStaticAssetUrl,
} = require("./geo");

function tryDecode(value) {
    const source = safeString(value);
    if (!source) return "";

    try {
        return decodeURIComponent(source);
    } catch {
        return source;
    }
}

function decodeHtmlEntities(value) {
    return safeString(value)
        .replace(/&amp;/gi, "&")
        .replace(/&#38;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function normalizeFetchedUrl(url) {
    return decodeHtmlEntities(tryDecode(url)).trim();
}

function isNavigableGoogleMapsUrl(url) {
    const u = normalizeFetchedUrl(url).toLowerCase();
    if (!u) return false;
    if (!looksLikeMapsUrl(u)) return false;
    if (isGoogleMapsStaticAssetUrl(u)) return false;

    return true;
}

function extractCoordsFromAnyText(text, options = {}) {
    const source = safeString(text);
    if (!source) {
        return { lat: null, lng: null };
    }

    const decoded = normalizeFetchedUrl(source);
    const treatAsAsset = options?.treatAsAsset === true;

    const patterns = [
        /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]query=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]destination=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]origin=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]saddr=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]daddr=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /[?&]ll=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
        /place\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
        /(?:^|[^0-9-])(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)(?:[^0-9]|$)/i,
    ];

    const assetOnlyPatterns = [
        /[?&]center=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    ];

    for (const pattern of patterns) {
        const match = decoded.match(pattern);
        if (!match?.[1] || !match?.[2]) continue;

        const lat = roundCoord(match[1]);
        const lng = roundCoord(match[2]);

        if (hasValidCoords(lat, lng)) {
            return { lat, lng };
        }
    }

    if (!treatAsAsset) {
        for (const pattern of assetOnlyPatterns) {
            const match = decoded.match(pattern);
            if (!match?.[1] || !match?.[2]) continue;

            const lat = roundCoord(match[1]);
            const lng = roundCoord(match[2]);

            if (hasValidCoords(lat, lng)) {
                return { lat, lng };
            }
        }
    }

    return { lat: null, lng: null };
}

function extractMapsUrlsFromHtml(html) {
    const source = decodeHtmlEntities(safeString(html));
    if (!source) return [];

    const matches = source.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];

    const cleaned = matches
        .map((raw) =>
            cleanupExtractedText(raw)
                .replace(/[)\],.;"'<>\\]+$/g, "")
                .trim()
        )
        .map((url) => normalizeFetchedUrl(url))
        .filter((url) => isNavigableGoogleMapsUrl(url));

    return Array.from(new Set(cleaned));
}

function extractCoordsFromHtmlMeta(html) {
    const source = safeString(html);
    if (!source) {
        return { lat: null, lng: null };
    }

    // Only look inside <script type="application/ld+json"> blocks to avoid
    // capturing Google Maps JS viewport/center data ("center":{"lat":...,"lng":...})
    // which is set to the server's regional default and is NOT the business location.
    const jsonLdBlocks = [];
    const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRe.exec(source)) !== null) {
        if (m[1]) jsonLdBlocks.push(m[1]);
    }

    for (const block of jsonLdBlocks) {
        const decoded = normalizeFetchedUrl(block);

        // schema.org JSON-LD uses "latitude"/"longitude" (not "lat"/"lng")
        const latMatch = decoded.match(/"latitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);
        const lngMatch = decoded.match(/"longitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);

        if (latMatch?.[1] && lngMatch?.[1]) {
            const lat = roundCoord(latMatch[1]);
            const lng = roundCoord(lngMatch[1]);
            if (hasValidCoords(lat, lng)) {
                return { lat, lng };
            }
        }
    }

    return { lat: null, lng: null };
}

function cleanupCandidateText(value) {
    const v = cleanupExtractedText(tryDecode(value))
        .replace(/\+/g, " ")
        .replace(/[_|]+/g, " ")
        .replace(/[-]{2,}/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!v) return "";
    if (v.length < 4) return "";

    return v;
}

function stripGoogleMapsNoise(value) {
    const v = cleanupCandidateText(value);
    if (!v) return "";

    return v
        .replace(/\bgoogle maps\b/gi, "")
        .replace(/\bmaps\b/gi, "")
        .replace(/\bdirections?\b/gi, "")
        .replace(/\broute\b/gi, "")
        .replace(/\bshare\b/gi, "")
        .replace(/\bplace\b/gi, "")
        .replace(/\bstatic map\b/gi, "")
        .replace(/\bmapa estatico\b/gi, "")
        .replace(/\bmapa estático\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function extractMetaContent(html, propertyOrName) {
    const source = safeString(html);
    if (!source) return "";

    const patterns = [
        new RegExp(
            `<meta[^>]+property=["']${propertyOrName}["'][^>]+content=["']([^"']+)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${propertyOrName}["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+name=["']${propertyOrName}["'][^>]+content=["']([^"']+)["']`,
            "i"
        ),
        new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${propertyOrName}["']`,
            "i"
        ),
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) {
            return cleanupCandidateText(decodeHtmlEntities(match[1]));
        }
    }

    return "";
}

function extractTitleText(html) {
    const source = safeString(html);
    if (!source) return "";

    const match = source.match(/<title[^>]*>([^<]+)<\/title>/i);
    return cleanupCandidateText(decodeHtmlEntities(match?.[1] || ""));
}

function extractPlaceTextFromUrl(url) {
    const source = safeString(url);
    if (!source) return [];

    const decoded = normalizeFetchedUrl(source);
    const out = [];

    const patterns = [
        /[?&]q=([^&]+)/i,
        /[?&]query=([^&]+)/i,
        /\/place\/([^/?#]+)/i,
        /\/search\/([^/?#]+)/i,
    ];

    for (const pattern of patterns) {
        const match = decoded.match(pattern);
        const raw = cleanupCandidateText(match?.[1] || "");
        if (!raw) continue;

        const cleaned = stripGoogleMapsNoise(raw);
        if (cleaned) out.push(cleaned);
    }

    return Array.from(new Set(out));
}

function extractTextCandidatesFromHtml(html) {
    const source = safeString(html);
    if (!source) return [];

    const candidates = [];

    const ogTitle = extractMetaContent(source, "og:title");
    const ogDescription = extractMetaContent(source, "og:description");
    const twitterTitle = extractMetaContent(source, "twitter:title");
    const title = extractTitleText(source);

    if (ogTitle) candidates.push(stripGoogleMapsNoise(ogTitle));
    if (ogDescription) candidates.push(stripGoogleMapsNoise(ogDescription));
    if (twitterTitle) candidates.push(stripGoogleMapsNoise(twitterTitle));
    if (title) candidates.push(stripGoogleMapsNoise(title));

    const jsonLdMatches = source.match(
        /"address"\s*:\s*\{[\s\S]*?"streetAddress"\s*:\s*"([^"]+)"[\s\S]*?"addressLocality"\s*:\s*"([^"]+)"[\s\S]*?"addressRegion"\s*:\s*"([^"]+)"/i
    );

    if (jsonLdMatches?.[1]) {
        const street = cleanupCandidateText(decodeHtmlEntities(jsonLdMatches[1]));
        const city = cleanupCandidateText(decodeHtmlEntities(jsonLdMatches[2]));
        const state = cleanupCandidateText(decodeHtmlEntities(jsonLdMatches[3]));
        const combined = [street, city, state].filter(Boolean).join(", ");
        if (combined) candidates.push(combined);
    }

    return Array.from(new Set(candidates.filter(Boolean)));
}

function buildGeocodeQueries(finalUrl, html, marketCountry = "BR") {
    const queries = [];
    const fromUrl = extractPlaceTextFromUrl(finalUrl);
    const fromHtml = extractTextCandidatesFromHtml(html);

    for (const item of [...fromUrl, ...fromHtml]) {
        const cleaned = stripGoogleMapsNoise(item);
        if (!cleaned) continue;
        queries.push(cleaned);
    }

    const unique = Array.from(new Set(queries.filter(Boolean)));
    const config = getMarketGeocodeConfig(marketCountry);
    const suffix = config.countrySuffix;
    const suffixLower = suffix.toLowerCase();

    const expanded = [];
    for (const q of unique) {
        expanded.push(q);

        const normalized = normalizeLooseText(q);
        if (normalized && !normalized.includes(suffixLower)) {
            expanded.push(`${q}, ${suffix}`);
        }
    }

    return Array.from(new Set(expanded.filter(Boolean)));
}

const MARKET_GEOCODE_CONFIG = {
    AR: {
        countrycodes: "ar",
        acceptLanguage: "es-AR",
        viewbox: "-73.56,-21.78,-53.63,-55.06",
        countrySuffix: "Argentina",
        placeHints: [
            "resistencia", "corrientes", "posadas", "formosa", "tucuman",
            "cordoba", "rosario", "buenos aires", "mendoza", "salta",
            "neuquen", "mar del plata", "chaco", "misiones",
        ],
    },
    PA: {
        countrycodes: "pa",
        acceptLanguage: "es-PA",
        viewbox: "-83.05,11.21,-77.20,7.20",
        countrySuffix: "Panama",
        placeHints: [
            "panama", "colon", "david", "santiago", "chitre", "penonome",
            "la chorrera", "san miguelito", "arraijan",
        ],
    },
    BR: {
        countrycodes: "br",
        acceptLanguage: "pt-BR",
        viewbox: "-73.99,5.27,-34.79,-33.75",
        countrySuffix: "Brasil",
        placeHints: [
            "belem", "belém", "ananindeua", "marituba", "castanhal",
            "para", "pará", "goiania", "goiânia", "manaus", "natal",
            "recife", "curitiba", "belo horizonte", "sao luis", "são luís", "brasil",
        ],
    },
};

function getMarketGeocodeConfig(marketCountry) {
    const key = String(marketCountry || "BR").toUpperCase();
    return MARKET_GEOCODE_CONFIG[key] || MARKET_GEOCODE_CONFIG.BR;
}

function looksSpecificEnoughForGeocode(query, marketCountry = "BR") {
    const q = normalizeLooseText(query);
    if (!q) return false;

    const config = getMarketGeocodeConfig(marketCountry);
    const hasNumber = /\b\d{1,6}\b/.test(q);

    const hasStreetWord =
        q.includes("rua ") ||
        q.includes("avenida") ||
        q.includes("av ") ||
        q.includes("av. ") ||
        q.includes("calle ") ||
        q.includes("travessa") ||
        q.includes("alameda") ||
        q.includes("estrada") ||
        q.includes("rodovia") ||
        q.includes("bairro") ||
        q.includes("barrio") ||
        q.includes("ruta ");

    if (hasStreetWord && hasNumber) return true;

    return config.placeHints.some((hint) => q.includes(hint));
}

async function geocodeTextForMarket(query, marketCountry = "BR") {
    const q = cleanupCandidateText(query);
    if (!q) return { lat: null, lng: null, label: "" };

    const config = getMarketGeocodeConfig(marketCountry);

    const url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(q)}` +
        `&format=jsonv2` +
        `&limit=3` +
        `&countrycodes=${config.countrycodes}` +
        `&addressdetails=1` +
        `&accept-language=${config.acceptLanguage}` +
        `&viewbox=${config.viewbox}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": "TrackGo/1.0 (maps text geocoder)",
                Accept: "application/json",
            },
        });

        if (!response.ok) return { lat: null, lng: null, label: q };

        const data = await response.json();
        const results = Array.isArray(data) ? data : [];

        for (const item of results) {
            const lat = roundCoord(item?.lat);
            const lng = roundCoord(item?.lon);
            const countryCode = safeString(item?.address?.country_code || "").toLowerCase();
            const displayName = safeString(item?.display_name || "");

            if (!hasValidCoords(lat, lng)) continue;
            if (countryCode !== config.countrycodes) continue;
            if (!displayName) continue;

            return { lat, lng, label: q };
        }

        return { lat: null, lng: null, label: q };
    } catch {
        return { lat: null, lng: null, label: q };
    }
}

function extractConsentContinueUrl(finalUrl, html) {
    const paramNames = ["continue", "redirect", "destination", "next", "return"];
    const urlStr = safeString(finalUrl);

    for (const name of paramNames) {
        const re = new RegExp(`[?&]${name}=([^&]+)`, "i");
        const match = urlStr.match(re);
        if (match?.[1]) {
            const decoded = normalizeFetchedUrl(tryDecode(match[1]));
            if (decoded && looksLikeMapsUrl(decoded)) return decoded;
        }
    }

    const source = safeString(html);
    if (!source) return "";

    // Only look for hidden form inputs — not arbitrary Maps URLs in the page
    for (const name of paramNames) {
        const patterns = [
            new RegExp(`<input[^>]+name=["']${name}["'][^>]+value=["']([^"']+)["']`, "i"),
            new RegExp(`<input[^>]+value=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"),
        ];
        for (const pattern of patterns) {
            const m = source.match(pattern);
            if (m?.[1]) {
                const decoded = normalizeFetchedUrl(tryDecode(m[1]));
                if (decoded && looksLikeMapsUrl(decoded)) return decoded;
            }
        }
    }

    return "";
}

async function fetchUrlFollowingRedirects(url, depth = 0) {
    const source = safeString(url);
    if (!source) {
        return {
            finalUrl: "",
            html: "",
            ok: false,
            status: 0,
        };
    }

    try {
        const response = await fetch(source, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "TrackGo/1.0 (google maps resolver)",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        });

        const finalUrl = normalizeFetchedUrl(response?.url || source);
        let html = "";

        try {
            html = await response.text();
        } catch {
            html = "";
        }

        if (finalUrl.includes("consent.google.com") && depth < 2) {
            const realUrl = extractConsentContinueUrl(finalUrl, html);
            if (realUrl) {
                return fetchUrlFollowingRedirects(realUrl, depth + 1);
            }
        }

        return {
            finalUrl,
            html,
            ok: !!response?.ok,
            status: Number(response?.status || 0),
        };
    } catch {
        return {
            finalUrl: normalizeFetchedUrl(source),
            html: "",
            ok: false,
            status: 0,
        };
    }
}

async function resolveCoordsFromGoogleMapsUrl(url, marketCountry = "BR") {
    const originalUrl = normalizeFetchedUrl(url);

    if (!originalUrl || !isNavigableGoogleMapsUrl(originalUrl)) {
        return {
            lat: null,
            lng: null,
            source: "",
            resolvedUrl: originalUrl,
            geocodeQuery: "",
        };
    }

    const direct = extractCoordsFromAnyText(originalUrl, {
        treatAsAsset: isGoogleMapsStaticAssetUrl(originalUrl),
    });
    if (hasValidCoords(direct.lat, direct.lng)) {
        return {
            lat: direct.lat,
            lng: direct.lng,
            source: "maps_url_direct",
            resolvedUrl: originalUrl,
            geocodeQuery: "",
        };
    }

    const fetched = await fetchUrlFollowingRedirects(originalUrl);
    const finalNavigableUrl = isNavigableGoogleMapsUrl(fetched.finalUrl)
        ? fetched.finalUrl
        : originalUrl;

    const fromFinalUrl = extractCoordsFromAnyText(finalNavigableUrl, {
        treatAsAsset: isGoogleMapsStaticAssetUrl(finalNavigableUrl),
    });
    if (hasValidCoords(fromFinalUrl.lat, fromFinalUrl.lng)) {
        return {
            lat: fromFinalUrl.lat,
            lng: fromFinalUrl.lng,
            source: "maps_url_redirect",
            resolvedUrl: finalNavigableUrl,
            geocodeQuery: "",
        };
    }

    // Use structured meta tags only — NOT raw HTML text (too broad, picks up wrong coords)
    const fromHtmlMeta = extractCoordsFromHtmlMeta(fetched.html);
    if (hasValidCoords(fromHtmlMeta.lat, fromHtmlMeta.lng)) {
        return {
            lat: fromHtmlMeta.lat,
            lng: fromHtmlMeta.lng,
            source: "maps_html_meta",
            resolvedUrl: finalNavigableUrl,
            geocodeQuery: "",
        };
    }

    const htmlUrls = extractMapsUrlsFromHtml(fetched.html);
    for (const nestedUrl of htmlUrls) {
        if (!isNavigableGoogleMapsUrl(nestedUrl)) continue;

        const nestedCoords = extractCoordsFromAnyText(nestedUrl, {
            treatAsAsset: isGoogleMapsStaticAssetUrl(nestedUrl),
        });

        if (hasValidCoords(nestedCoords.lat, nestedCoords.lng)) {
            return {
                lat: nestedCoords.lat,
                lng: nestedCoords.lng,
                source: "maps_nested_url",
                resolvedUrl: nestedUrl,
                geocodeQuery: "",
            };
        }

        const nestedFetched = await fetchUrlFollowingRedirects(nestedUrl);
        const nestedFinalUrl = isNavigableGoogleMapsUrl(nestedFetched.finalUrl)
            ? nestedFetched.finalUrl
            : nestedUrl;

        const nestedFromFinal = extractCoordsFromAnyText(nestedFinalUrl, {
            treatAsAsset: isGoogleMapsStaticAssetUrl(nestedFinalUrl),
        });
        if (hasValidCoords(nestedFromFinal.lat, nestedFromFinal.lng)) {
            return {
                lat: nestedFromFinal.lat,
                lng: nestedFromFinal.lng,
                source: "maps_nested_redirect",
                resolvedUrl: nestedFinalUrl,
                geocodeQuery: "",
            };
        }

        const nestedFromHtmlMeta = extractCoordsFromHtmlMeta(nestedFetched.html);
        if (hasValidCoords(nestedFromHtmlMeta.lat, nestedFromHtmlMeta.lng)) {
            return {
                lat: nestedFromHtmlMeta.lat,
                lng: nestedFromHtmlMeta.lng,
                source: "maps_nested_html_meta",
                resolvedUrl: nestedFinalUrl,
                geocodeQuery: "",
            };
        }
    }

    const geocodeQueries = buildGeocodeQueries(finalNavigableUrl, fetched.html, marketCountry);

    for (const query of geocodeQueries) {
        if (!looksSpecificEnoughForGeocode(query, marketCountry)) {
            continue;
        }

        const geocoded = await geocodeTextForMarket(query, marketCountry);
        if (hasValidCoords(geocoded.lat, geocoded.lng)) {
            return {
                lat: geocoded.lat,
                lng: geocoded.lng,
                source: "maps_text_geocode",
                resolvedUrl: finalNavigableUrl,
                geocodeQuery: geocoded.label || query,
            };
        }
    }

    return {
        lat: null,
        lng: null,
        source: "maps_unresolved",
        resolvedUrl: finalNavigableUrl,
        geocodeQuery: "",
    };
}

module.exports = {
    extractCoordsFromAnyText,
    resolveCoordsFromGoogleMapsUrl,
};