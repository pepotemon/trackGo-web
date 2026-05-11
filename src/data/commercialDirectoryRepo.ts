import {
    collection,
    doc,
    getDocs,
    increment,
    limit,
    orderBy,
    query,
    where,
    writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
    CommercialDirectoryCategoryDoc,
    CommercialDirectoryAssignmentDoc,
    CommercialDirectoryImportDoc,
    CommercialDirectoryLocationDoc,
    CommercialDirectoryParsedRow,
    CommercialDirectoryProspectDoc,
    CommercialDirectoryProspectTouchDoc,
} from "@/types/commercialDirectory";
import type { UserDoc } from "@/types/users";

const LOCATIONS = "commercialDirectoryLocations";
const CATEGORIES = "commercialDirectoryCategories";
const PROSPECTS = "commercialDirectoryProspects";
const IMPORTS = "commercialDirectoryImports";
const ASSIGNMENTS = "commercialDirectoryAssignments";
const TOUCHES = "commercialDirectoryProspectTouches";

export function normalizeDirectoryText(value: unknown) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function buildCountryId(name: string) {
    return `country_${normalizeDirectoryText(name) || "sin_pais"}`;
}

export function buildCityId(countryId: string, name: string) {
    return `city_${countryId}_${normalizeDirectoryText(name) || "sin_ciudad"}`;
}

export function buildNeighborhoodId(cityId: string, name: string) {
    return `neighborhood_${cityId}_${normalizeDirectoryText(name) || "sin_barrio"}`;
}

export function buildCategoryId(neighborhoodId: string, name: string) {
    return `category_${neighborhoodId}_${normalizeDirectoryText(name) || "sin_categoria"}`;
}

function chunks<T>(items: T[], size: number) {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

async function commitDeleteRefs(refs: ReturnType<typeof doc>[]) {
    for (const part of chunks(refs, 430)) {
        const batch = writeBatch(db);
        part.forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
}

async function refsByQuery(collectionName: string, field: string, value: string) {
    const snap = await getDocs(query(collection(db, collectionName), where(field, "==", value)));
    return snap.docs.map((item) => item.ref);
}

function locationDoc(input: {
    id: string;
    type: CommercialDirectoryLocationDoc["type"];
    name: string;
    parentId: string | null;
    pathIds: string[];
    countryId?: string;
    cityId?: string;
    now: number;
}): Omit<CommercialDirectoryLocationDoc, "prospectCount" | "categoryCount"> {
    return {
        id: input.id,
        type: input.type,
        name: input.name.trim(),
        normalizedName: normalizeDirectoryText(input.name),
        parentId: input.parentId,
        pathIds: input.pathIds,
        ...(input.countryId ? { countryId: input.countryId } : {}),
        ...(input.cityId ? { cityId: input.cityId } : {}),
        createdAt: input.now,
        updatedAt: input.now,
    };
}

export async function listDirectoryLocations(): Promise<CommercialDirectoryLocationDoc[]> {
    const snap = await getDocs(query(collection(db, LOCATIONS), orderBy("name", "asc"), limit(1000)));
    return snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryLocationDoc, "id">) }));
}

export async function listDirectoryCategories(neighborhoodId: string): Promise<CommercialDirectoryCategoryDoc[]> {
    if (!neighborhoodId) return [];
    const snap = await getDocs(query(
        collection(db, CATEGORIES),
        where("neighborhoodId", "==", neighborhoodId),
        limit(300)
    ));
    return snap.docs
        .map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryCategoryDoc, "id">) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDirectoryProspects(input: {
    neighborhoodId: string;
    categoryId?: string;
}): Promise<CommercialDirectoryProspectDoc[]> {
    if (!input.neighborhoodId) return [];

    const constraints = [
        where("neighborhoodId", "==", input.neighborhoodId),
        ...(input.categoryId ? [where("categoryId", "==", input.categoryId)] : []),
        limit(300),
    ];

    const snap = await getDocs(query(collection(db, PROSPECTS), ...constraints));
    return snap.docs
        .map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryProspectDoc, "id">) }))
        .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

export async function listDirectoryImports(): Promise<CommercialDirectoryImportDoc[]> {
    const snap = await getDocs(query(collection(db, IMPORTS), orderBy("createdAt", "desc"), limit(30)));
    return snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryImportDoc, "id">) }));
}

export function directoryAssignmentId(userId: string, cityId: string) {
    return `${userId}_${cityId}`;
}

export function directoryTouchId(userId: string, prospectId: string) {
    return `${userId}_${prospectId}`;
}

export function userMatchesDirectoryCity(user: UserDoc, city: CommercialDirectoryLocationDoc) {
    if (user.role !== "user" || user.active === false) return false;
    const cityKey = normalizeDirectoryText(city.name);
    const coverage = Array.isArray(user.geoCoverage) ? user.geoCoverage : [];
    return coverage.some((item) => {
        if (item.active === false) return false;
        const coverageCity = normalizeDirectoryText(item.cityNormalized || item.cityLabel);
        const coverageLabel = normalizeDirectoryText(item.displayLabel);
        if (!coverageCity && !coverageLabel) return false;
        return Boolean(coverageCity && (coverageCity === cityKey || coverageCity.includes(cityKey) || cityKey.includes(coverageCity)))
            || Boolean(coverageLabel && coverageLabel.includes(cityKey));
    });
}

export async function listDirectoryAssignmentsForCity(cityId: string): Promise<CommercialDirectoryAssignmentDoc[]> {
    if (!cityId) return [];
    const snap = await getDocs(query(collection(db, ASSIGNMENTS), where("cityId", "==", cityId), limit(300)));
    return snap.docs
        .map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryAssignmentDoc, "id">) }))
        .sort((a, b) => a.userName.localeCompare(b.userName));
}

export async function listMyDirectoryAssignments(userId: string): Promise<CommercialDirectoryAssignmentDoc[]> {
    if (!userId) return [];
    const snap = await getDocs(query(collection(db, ASSIGNMENTS), where("userId", "==", userId), limit(100)));
    return snap.docs
        .map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryAssignmentDoc, "id">) }))
        .sort((a, b) => a.cityName.localeCompare(b.cityName));
}

export async function assignCommercialDirectoryCity(input: {
    user: Pick<UserDoc, "id" | "name" | "email">;
    country: CommercialDirectoryLocationDoc;
    city: CommercialDirectoryLocationDoc;
    assignedBy: string;
    assignedByName: string;
}) {
    const now = Date.now();
    const id = directoryAssignmentId(input.user.id, input.city.id);
    const assignment: CommercialDirectoryAssignmentDoc = {
        id,
        userId: input.user.id,
        userName: input.user.name || input.user.email || input.user.id,
        userEmail: input.user.email || "",
        countryId: input.country.id,
        countryName: input.country.name,
        cityId: input.city.id,
        cityName: input.city.name,
        assignedBy: input.assignedBy,
        assignedByName: input.assignedByName,
        createdAt: now,
        updatedAt: now,
    };
    const batch = writeBatch(db);
    batch.set(doc(db, ASSIGNMENTS, id), assignment, { merge: true });
    await batch.commit();
    return assignment;
}

export async function removeCommercialDirectoryAssignment(assignmentId: string) {
    const batch = writeBatch(db);
    batch.delete(doc(db, ASSIGNMENTS, assignmentId));
    await batch.commit();
}

export async function listDirectoryProspectsForCities(cityIds: string[]): Promise<CommercialDirectoryProspectDoc[]> {
    const ids = Array.from(new Set(cityIds.filter(Boolean))).slice(0, 30);
    if (!ids.length) return [];

    const out: CommercialDirectoryProspectDoc[] = [];
    for (const part of chunks(ids, 10)) {
        const snap = await getDocs(query(collection(db, PROSPECTS), where("cityId", "in", part), limit(800)));
        out.push(...snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryProspectDoc, "id">) })));
    }

    return out.sort((a, b) =>
        a.neighborhoodName.localeCompare(b.neighborhoodName)
        || a.categoryName.localeCompare(b.categoryName)
        || a.name.localeCompare(b.name)
    );
}

export async function listMyDirectoryTouches(userId: string): Promise<CommercialDirectoryProspectTouchDoc[]> {
    if (!userId) return [];
    const snap = await getDocs(query(collection(db, TOUCHES), where("userId", "==", userId), limit(1000)));
    return snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<CommercialDirectoryProspectTouchDoc, "id">) }));
}

export async function markDirectoryProspectContacted(input: {
    userId: string;
    prospectId: string;
    cityId: string;
}) {
    const now = Date.now();
    const id = directoryTouchId(input.userId, input.prospectId);
    const batch = writeBatch(db);
    batch.set(doc(db, TOUCHES, id), {
        id,
        userId: input.userId,
        prospectId: input.prospectId,
        cityId: input.cityId,
        contacted: true,
        contactedAt: now,
        updatedAt: now,
    }, { merge: true });
    await batch.commit();
}

export async function saveDirectoryProspectNote(input: {
    userId: string;
    prospectId: string;
    cityId: string;
    note: string;
}) {
    const now = Date.now();
    const id = directoryTouchId(input.userId, input.prospectId);
    const batch = writeBatch(db);
    batch.set(doc(db, TOUCHES, id), {
        id,
        userId: input.userId,
        prospectId: input.prospectId,
        cityId: input.cityId,
        note: input.note.trim(),
        updatedAt: now,
    }, { merge: true });
    await batch.commit();
}

export async function createDirectoryLocation(input: {
    countryName: string;
    cityName?: string;
    neighborhoodName?: string;
}) {
    const countryName = input.countryName.trim();
    const cityName = input.cityName?.trim() ?? "";
    const neighborhoodName = input.neighborhoodName?.trim() ?? "";

    if (!countryName) throw new Error("Escribe el pais.");

    const now = Date.now();
    const countryId = buildCountryId(countryName);
    const batch = writeBatch(db);

    batch.set(doc(db, LOCATIONS, countryId), locationDoc({
        id: countryId,
        type: "country",
        name: countryName,
        parentId: null,
        pathIds: [countryId],
        now,
    }), { merge: true });

    let cityId = "";
    let neighborhoodId = "";

    if (cityName) {
        cityId = buildCityId(countryId, cityName);
        batch.set(doc(db, LOCATIONS, cityId), locationDoc({
            id: cityId,
            type: "city",
            name: cityName,
            parentId: countryId,
            pathIds: [countryId, cityId],
            countryId,
            now,
        }), { merge: true });
    }

    if (cityId && neighborhoodName) {
        neighborhoodId = buildNeighborhoodId(cityId, neighborhoodName);
        batch.set(doc(db, LOCATIONS, neighborhoodId), locationDoc({
            id: neighborhoodId,
            type: "neighborhood",
            name: neighborhoodName,
            parentId: cityId,
            pathIds: [countryId, cityId, neighborhoodId],
            countryId,
            cityId,
            now,
        }), { merge: true });
    }

    await batch.commit();
    return { countryId, cityId, neighborhoodId };
}

export async function findExistingCommercialDuplicateKeys(keys: string[]): Promise<Set<string>> {
    const cleanKeys = Array.from(new Set(keys.filter(Boolean)));
    const found = new Set<string>();
    if (!cleanKeys.length) return found;

    for (const part of chunks(cleanKeys, 30)) {
        const snap = await getDocs(query(
            collection(db, PROSPECTS),
            where("dedupeKeys", "array-contains-any", part),
            limit(100)
        ));

        for (const item of snap.docs) {
            const dedupeKeys = item.data().dedupeKeys;
            if (!Array.isArray(dedupeKeys)) continue;
            for (const key of dedupeKeys) {
                if (part.includes(String(key))) found.add(String(key));
            }
        }
    }

    return found;
}

export async function importCommercialDirectory(input: {
    fileName: string;
    countryName: string;
    cityName: string;
    neighborhoodName: string;
    rows: CommercialDirectoryParsedRow[];
    importedBy: string;
    importedByName: string;
}) {
    const validRows = input.rows.filter((row) => row.validationErrors.length === 0);
    if (!validRows.length) throw new Error("No hay filas validas para importar.");

    const now = Date.now();
    const countryId = buildCountryId(input.countryName);
    const cityId = buildCityId(countryId, input.cityName);
    const neighborhoodId = buildNeighborhoodId(cityId, input.neighborhoodName);
    const importRef = doc(collection(db, IMPORTS));
    const importId = importRef.id;
    const categories = Array.from(new Set(validRows.map((row) => row.categoryName.trim()).filter(Boolean)));
    const batches = [writeBatch(db)];
    let currentBatch = batches[0];
    let writes = 0;

    function addWrite(fn: (batch: ReturnType<typeof writeBatch>) => void) {
        if (writes >= 430) {
            currentBatch = writeBatch(db);
            batches.push(currentBatch);
            writes = 0;
        }
        fn(currentBatch);
        writes += 1;
    }

    addWrite((batch) => batch.set(doc(db, LOCATIONS, countryId), locationDoc({
        id: countryId,
        type: "country",
        name: input.countryName,
        parentId: null,
        pathIds: [countryId],
        now,
    }), { merge: true }));

    addWrite((batch) => batch.set(doc(db, LOCATIONS, cityId), locationDoc({
        id: cityId,
        type: "city",
        name: input.cityName,
        parentId: countryId,
        pathIds: [countryId, cityId],
        countryId,
        now,
    }), { merge: true }));

    addWrite((batch) => batch.set(doc(db, LOCATIONS, neighborhoodId), locationDoc({
        id: neighborhoodId,
        type: "neighborhood",
        name: input.neighborhoodName,
        parentId: cityId,
        pathIds: [countryId, cityId, neighborhoodId],
        countryId,
        cityId,
        now,
    }), { merge: true }));

    const byCategory = new Map<string, number>();
    for (const row of validRows) {
        const categoryId = buildCategoryId(neighborhoodId, row.categoryName);
        byCategory.set(categoryId, (byCategory.get(categoryId) ?? 0) + 1);
    }

    for (const categoryName of categories) {
        const categoryId = buildCategoryId(neighborhoodId, categoryName);
        const count = byCategory.get(categoryId) ?? 0;
        addWrite((batch) => batch.set(doc(db, CATEGORIES, categoryId), {
            id: categoryId,
            name: categoryName.trim(),
            normalizedName: normalizeDirectoryText(categoryName),
            countryId,
            cityId,
            neighborhoodId,
            prospectCount: increment(count),
            createdAt: now,
            updatedAt: now,
        }, { merge: true }));
    }

    for (const row of validRows) {
        const categoryId = buildCategoryId(neighborhoodId, row.categoryName);
        const prospectRef = doc(collection(db, PROSPECTS));
        const prospect: CommercialDirectoryProspectDoc = {
            id: prospectRef.id,
            name: row.name,
            phone: row.phone,
            phoneDigits: row.phone.replace(/\D+/g, ""),
            address: row.address,
            latitude: row.latitude,
            longitude: row.longitude,
            googleMapsLink: row.googleMapsLink,
            status: "new",
            source: "public_import",
            importId,
            sourceFileName: input.fileName,
            countryId,
            countryName: input.countryName.trim(),
            cityId,
            cityName: input.cityName.trim(),
            neighborhoodId,
            neighborhoodName: input.neighborhoodName.trim(),
            categoryId,
            categoryName: row.categoryName.trim(),
            dedupeKeys: row.dedupeKeys,
            assignedTo: null,
            assignedAt: null,
            contactedAt: null,
            convertedClientId: null,
            importedBy: input.importedBy,
            importedByName: input.importedByName,
            createdAt: now,
            updatedAt: now,
        };
        addWrite((batch) => batch.set(prospectRef, prospect));
    }

    addWrite((batch) => batch.set(doc(db, LOCATIONS, countryId), {
        prospectCount: increment(validRows.length),
        updatedAt: now,
    }, { merge: true }));
    addWrite((batch) => batch.set(doc(db, LOCATIONS, cityId), {
        prospectCount: increment(validRows.length),
        updatedAt: now,
    }, { merge: true }));
    addWrite((batch) => batch.set(doc(db, LOCATIONS, neighborhoodId), {
        prospectCount: increment(validRows.length),
        categoryCount: increment(categories.length),
        updatedAt: now,
    }, { merge: true }));

    const importDoc: CommercialDirectoryImportDoc = {
        id: importId,
        fileName: input.fileName,
        countryId,
        countryName: input.countryName.trim(),
        cityId,
        cityName: input.cityName.trim(),
        neighborhoodId,
        neighborhoodName: input.neighborhoodName.trim(),
        categoryNames: categories,
        totalRows: input.rows.length,
        insertedCount: validRows.length,
        duplicateCount: input.rows.filter((row) => row.validationErrors.includes("Duplicado")).length,
        invalidCount: input.rows.filter((row) => row.validationErrors.length > 0 && !row.validationErrors.includes("Duplicado")).length,
        importedBy: input.importedBy,
        importedByName: input.importedByName,
        createdAt: now,
    };
    addWrite((batch) => batch.set(importRef, importDoc));

    for (const batch of batches) await batch.commit();
    return importDoc;
}

export async function deleteCommercialDirectoryCategory(input: {
    categoryId: string;
    neighborhoodId: string;
    cityId: string;
    countryId: string;
    prospectCount: number;
}) {
    const prospectRefs = await refsByQuery(PROSPECTS, "categoryId", input.categoryId);
    const batch = writeBatch(db);
    batch.delete(doc(db, CATEGORIES, input.categoryId));
    batch.set(doc(db, LOCATIONS, input.neighborhoodId), {
        prospectCount: increment(-Math.max(0, prospectRefs.length || input.prospectCount)),
        categoryCount: increment(-1),
        updatedAt: Date.now(),
    }, { merge: true });
    batch.set(doc(db, LOCATIONS, input.cityId), {
        prospectCount: increment(-Math.max(0, prospectRefs.length || input.prospectCount)),
        updatedAt: Date.now(),
    }, { merge: true });
    batch.set(doc(db, LOCATIONS, input.countryId), {
        prospectCount: increment(-Math.max(0, prospectRefs.length || input.prospectCount)),
        updatedAt: Date.now(),
    }, { merge: true });
    await batch.commit();
    await commitDeleteRefs(prospectRefs);
    return { deletedProspects: prospectRefs.length };
}

export async function deleteCommercialDirectoryNeighborhood(input: {
    neighborhoodId: string;
    cityId: string;
    countryId: string;
}) {
    const [prospectRefs, categoryRefs] = await Promise.all([
        refsByQuery(PROSPECTS, "neighborhoodId", input.neighborhoodId),
        refsByQuery(CATEGORIES, "neighborhoodId", input.neighborhoodId),
    ]);

    await commitDeleteRefs([...prospectRefs, ...categoryRefs, doc(db, LOCATIONS, input.neighborhoodId)]);

    const batch = writeBatch(db);
    batch.set(doc(db, LOCATIONS, input.cityId), {
        prospectCount: increment(-prospectRefs.length),
        updatedAt: Date.now(),
    }, { merge: true });
    batch.set(doc(db, LOCATIONS, input.countryId), {
        prospectCount: increment(-prospectRefs.length),
        updatedAt: Date.now(),
    }, { merge: true });
    await batch.commit();
    return { deletedProspects: prospectRefs.length, deletedCategories: categoryRefs.length };
}

export async function deleteCommercialDirectoryCity(input: {
    cityId: string;
    countryId: string;
}) {
    const neighborhoodsSnap = await getDocs(query(collection(db, LOCATIONS), where("parentId", "==", input.cityId)));
    const neighborhoodIds = neighborhoodsSnap.docs.map((item) => item.id);
    const prospectRefs: ReturnType<typeof doc>[] = [];
    const categoryRefs: ReturnType<typeof doc>[] = [];

    for (const neighborhoodId of neighborhoodIds) {
        prospectRefs.push(...await refsByQuery(PROSPECTS, "neighborhoodId", neighborhoodId));
        categoryRefs.push(...await refsByQuery(CATEGORIES, "neighborhoodId", neighborhoodId));
    }

    const locationRefs = [
        ...neighborhoodsSnap.docs.map((item) => item.ref),
        doc(db, LOCATIONS, input.cityId),
    ];

    await commitDeleteRefs([...prospectRefs, ...categoryRefs, ...locationRefs]);

    const batch = writeBatch(db);
    batch.set(doc(db, LOCATIONS, input.countryId), {
        prospectCount: increment(-prospectRefs.length),
        updatedAt: Date.now(),
    }, { merge: true });
    await batch.commit();
    return {
        deletedProspects: prospectRefs.length,
        deletedCategories: categoryRefs.length,
        deletedNeighborhoods: neighborhoodIds.length,
    };
}
