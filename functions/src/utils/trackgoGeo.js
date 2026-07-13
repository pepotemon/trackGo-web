function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

function roundGeo(value, decimals = 2) {
    if (!isFiniteNumber(value)) return null;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function deg2rad(deg) {
    return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLng = deg2rad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) *
        Math.cos(deg2rad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Plaza operativa / ciudad comercial.
 *
 * radiusKm:
 * - dentro de este radio => ciudad válida / operativa
 *
 * hardRadiusKm:
 * - fuera de radiusKm pero dentro de hardRadiusKm => queda marcada
 *   como fuera de plaza, pero con nearest hub de referencia
 */
const TRACKGO_CITY_HUBS = [
    {
        key: "goiania",
        label: "Goiânia",
        cluster: "goiania",
        lat: -16.6869,
        lng: -49.2648,
        radiusKm: 28,
        hardRadiusKm: 55,
    },
    {
        key: "belem",
        label: "Belém",
        cluster: "belem",
        lat: -1.4558,
        lng: -48.5039,
        radiusKm: 24,
        hardRadiusKm: 48,
    },
    {
        key: "manaus",
        label: "Manaus",
        cluster: "manaus",
        lat: -3.119,
        lng: -60.0217,
        radiusKm: 30,
        hardRadiusKm: 60,
    },
    {
        key: "belo_horizonte",
        label: "Belo Horizonte",
        cluster: "belo_horizonte",
        lat: -19.9167,
        lng: -43.9345,
        radiusKm: 26,
        hardRadiusKm: 52,
    },
    {
        key: "curitiba",
        label: "Curitiba",
        cluster: "curitiba",
        lat: -25.4284,
        lng: -49.2733,
        radiusKm: 28,
        hardRadiusKm: 56,
    },
    {
        key: "recife",
        label: "Recife",
        cluster: "recife",
        lat: -8.0476,
        lng: -34.877,
        radiusKm: 24,
        hardRadiusKm: 48,
    },
    {
        key: "natal",
        label: "Natal",
        cluster: "natal",
        lat: -5.7945,
        lng: -35.211,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
    {
        key: "sao_luis",
        label: "São Luís",
        cluster: "sao_luis",
        lat: -2.5297,
        lng: -44.3028,
        radiusKm: 24,
        hardRadiusKm: 48,
    },
];

const TRACKGO_PANAMA_CITY_HUBS = [
    {
        key: "ciudad_de_panama",
        label: "Ciudad de Panama",
        cluster: "panama_metro",
        lat: 8.9824,
        lng: -79.5199,
        radiusKm: 28,
        hardRadiusKm: 58,
    },
    {
        key: "san_miguelito",
        label: "San Miguelito",
        cluster: "panama_metro",
        lat: 9.0333,
        lng: -79.5,
        radiusKm: 18,
        hardRadiusKm: 38,
    },
    {
        key: "la_chorrera",
        label: "La Chorrera",
        cluster: "panama_oeste",
        lat: 8.8803,
        lng: -79.7833,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
    {
        key: "colon",
        label: "Colon",
        cluster: "colon",
        lat: 9.3592,
        lng: -79.9014,
        radiusKm: 24,
        hardRadiusKm: 48,
    },
    {
        key: "david",
        label: "David",
        cluster: "chiriqui",
        lat: 8.4273,
        lng: -82.4309,
        radiusKm: 24,
        hardRadiusKm: 48,
    },
    {
        key: "santiago",
        label: "Santiago",
        cluster: "veraguas",
        lat: 8.1,
        lng: -80.9833,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
    {
        key: "chitre",
        label: "Chitre",
        cluster: "azuero",
        lat: 7.9667,
        lng: -80.4333,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
];

const TRACKGO_ARGENTINA_CITY_HUBS = [
    {
        key: "resistencia",
        label: "Resistencia",
        cluster: "chaco",
        lat: -27.4518,
        lng: -58.9900,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
    {
        key: "corrientes",
        label: "Corrientes",
        cluster: "corrientes",
        lat: -27.4691,
        lng: -58.8306,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
    {
        key: "formosa",
        label: "Formosa",
        cluster: "formosa",
        lat: -26.1775,
        lng: -58.1781,
        radiusKm: 20,
        hardRadiusKm: 40,
    },
    {
        key: "posadas",
        label: "Posadas",
        cluster: "misiones",
        lat: -27.3671,
        lng: -55.8960,
        radiusKm: 20,
        hardRadiusKm: 40,
    },
    {
        key: "buenos_aires",
        label: "Buenos Aires",
        cluster: "buenos_aires",
        lat: -34.6132,
        lng: -58.3772,
        radiusKm: 35,
        hardRadiusKm: 70,
    },
    {
        key: "cordoba",
        label: "Córdoba",
        cluster: "cordoba",
        lat: -31.4167,
        lng: -64.1833,
        radiusKm: 26,
        hardRadiusKm: 52,
    },
    {
        key: "rosario",
        label: "Rosario",
        cluster: "rosario",
        lat: -32.9468,
        lng: -60.6393,
        radiusKm: 24,
        hardRadiusKm: 48,
    },
    {
        key: "tucuman",
        label: "Tucumán",
        cluster: "tucuman",
        lat: -26.8256,
        lng: -65.2066,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
    {
        key: "salta",
        label: "Salta",
        cluster: "salta",
        lat: -24.7821,
        lng: -65.4232,
        radiusKm: 22,
        hardRadiusKm: 44,
    },
    {
        key: "mendoza",
        label: "Mendoza",
        cluster: "mendoza",
        lat: -32.8908,
        lng: -68.8272,
        radiusKm: 24,
        hardRadiusKm: 48,
    },
];

function getHubsForMarket(marketCountry) {
    const country = String(marketCountry || "").trim().toUpperCase();

    if (country === "PA") return TRACKGO_PANAMA_CITY_HUBS;
    if (country === "AR") return TRACKGO_ARGENTINA_CITY_HUBS;

    return TRACKGO_CITY_HUBS;
}

function buildEmptyTrackGoGeo() {
    return {
        geoCityLabel: null,
        geoCityNormalized: null,
        geoCluster: null,
        geoSource: null,
        geoResolvedAt: null,
        geoDistanceToHubKm: null,
        geoOutOfCoverage: null,
        geoConfidence: null,
        geoNearestHubKey: null,
        geoNearestHubLabel: null,
    };
}

function resolveTrackGoGeoFromCoords(lat, lng, now = Date.now(), marketCountry = "BR") {
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
        return buildEmptyTrackGoGeo();
    }

    const hubs = getHubsForMarket(marketCountry);
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const hub of hubs) {
        const distance = haversineKm(lat, lng, hub.lat, hub.lng);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = hub;
        }
    }

    if (!nearest || !Number.isFinite(nearestDistance)) {
        return buildEmptyTrackGoGeo();
    }

    const distanceKm = roundGeo(nearestDistance, 2);

    if (nearestDistance <= nearest.radiusKm) {
        const confidence =
            nearestDistance <= nearest.radiusKm * 0.55 ? "high" : "medium";

        return {
            geoCityLabel: nearest.label,
            geoCityNormalized: nearest.key,
            geoCluster: nearest.cluster,
            geoSource: "coords_hub",
            geoResolvedAt: now,
            geoDistanceToHubKm: distanceKm,
            geoOutOfCoverage: false,
            geoConfidence: confidence,
            geoNearestHubKey: nearest.key,
            geoNearestHubLabel: nearest.label,
        };
    }

    if (nearestDistance <= nearest.hardRadiusKm) {
        return {
            geoCityLabel: nearest.label,
            geoCityNormalized: nearest.key,
            geoCluster: nearest.cluster,
            geoSource: "coords_hub",
            geoResolvedAt: now,
            geoDistanceToHubKm: distanceKm,
            geoOutOfCoverage: true,
            geoConfidence: "low",
            geoNearestHubKey: nearest.key,
            geoNearestHubLabel: nearest.label,
        };
    }

    return {
        geoCityLabel: null,
        geoCityNormalized: null,
        geoCluster: null,
        geoSource: "coords_hub",
        geoResolvedAt: now,
        geoDistanceToHubKm: distanceKm,
        geoOutOfCoverage: true,
        geoConfidence: "low",
        geoNearestHubKey: nearest.key,
        geoNearestHubLabel: nearest.label,
    };
}

module.exports = {
    TRACKGO_CITY_HUBS,
    TRACKGO_PANAMA_CITY_HUBS,
    TRACKGO_ARGENTINA_CITY_HUBS,
    buildEmptyTrackGoGeo,
    resolveTrackGoGeoFromCoords,
};
