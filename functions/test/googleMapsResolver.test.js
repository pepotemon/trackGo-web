const assert = require("node:assert/strict");
const test = require("node:test");

const {
    resolveCoordsFromGoogleMapsUrl,
} = require("../src/utils/googleMapsResolver");

test("resolves a Brazilian Maps place URL that only contains city, state, and CEP", async () => {
    const originalFetch = global.fetch;
    const mapsUrl = "https://maps.app.goo.gl/bx5mFCEx54qA8CEy6?g_st=aw";
    const finalMapsUrl = "https://www.google.com/maps/place/ADEGA+3+IRMAOS+-+Santa+Cecilia,+Patos+-+PB,+58708-170";

    global.fetch = async (url) => {
        if (String(url).startsWith("https://maps.app.goo.gl/")) {
            return {
                ok: true,
                status: 200,
                url: finalMapsUrl,
                text: async () => "",
            };
        }

        assert.match(String(url), /nominatim\.openstreetmap\.org\/search/);
        assert.match(decodeURIComponent(String(url)), /Patos.*PB.*58708-170/);

        return {
            ok: true,
            status: 200,
            json: async () => [{
                lat: "-7.017800",
                lon: "-37.275100",
                display_name: "Santa Cecilia, Patos, Paraiba, Brasil",
                address: { country_code: "br" },
            }],
        };
    };

    try {
        const result = await resolveCoordsFromGoogleMapsUrl(mapsUrl, "BR");
        assert.equal(result.source, "maps_text_geocode");
        assert.equal(result.lat, -7.0178);
        assert.equal(result.lng, -37.2751);
        assert.match(result.geocodeQuery, /Patos.*PB.*58708-170/);
    } finally {
        global.fetch = originalFetch;
    }
});
