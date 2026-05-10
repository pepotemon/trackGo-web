"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppIcon, Badge, Button, Card, Field, IconButton, Input, KpiCard, Modal, PageHeader } from "@/components/ui";
import {
    createDirectoryLocation,
    deleteCommercialDirectoryCategory,
    deleteCommercialDirectoryCity,
    deleteCommercialDirectoryNeighborhood,
    findExistingCommercialDuplicateKeys,
    importCommercialDirectory,
    listDirectoryCategories,
    listDirectoryImports,
    listDirectoryLocations,
    listDirectoryProspects,
    normalizeDirectoryText,
} from "@/data/commercialDirectoryRepo";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCan } from "@/features/auth/usePermissions";
import type {
    CommercialDirectoryCategoryDoc,
    CommercialDirectoryImportDoc,
    CommercialDirectoryImportPreview,
    CommercialDirectoryLocationDoc,
    CommercialDirectoryParsedRow,
    CommercialDirectoryProspectDoc,
} from "@/types/commercialDirectory";

const REQUIRED_COLUMNS = ["Nome", "Telefone", "Endereco", "Latitude", "Longitude", "LinkGoogleMaps"] as const;
type DeleteTarget = "category" | "neighborhood" | "city";

function cleanText(value: unknown) {
    return String(value ?? "").trim();
}

function cleanPhone(value: unknown) {
    return cleanText(value).replace(/\s+/g, " ");
}

function phoneDigits(value: unknown) {
    return cleanText(value).replace(/\D+/g, "");
}

function numberOrNull(value: unknown) {
    const text = cleanText(value).replace(",", ".");
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}

function mapKey(value: unknown) {
    const text = cleanText(value).toLowerCase();
    if (!text) return "";
    return `maps:${text.replace(/[?#].*$/, "").replace(/\/+$/, "")}`;
}

function buildDedupeKeys(input: { name: string; phone: string; address: string; googleMapsLink: string }) {
    const keys: string[] = [];
    const digits = phoneDigits(input.phone);
    if (digits.length >= 7) keys.push(`phone:${digits}`);
    const maps = mapKey(input.googleMapsLink);
    if (maps) keys.push(maps);
    const nameAddress = normalizeDirectoryText(`${input.name}_${input.address}`);
    if (input.name && input.address && nameAddress.length >= 8) keys.push(`name_address:${nameAddress}`);
    return Array.from(new Set(keys));
}

function locationCount(location?: CommercialDirectoryLocationDoc | null) {
    return Number(location?.prospectCount ?? 0);
}

function categoryCount(category?: CommercialDirectoryCategoryDoc | null) {
    return Number(category?.prospectCount ?? 0);
}

async function parseWorkbook(file: File): Promise<CommercialDirectoryImportPreview> {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows: CommercialDirectoryParsedRow[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
        const header = (matrix[0] ?? []).map(cleanText);
        const columnIndex = new Map(header.map((name, index) => [name, index]));
        const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column));

        for (let index = 1; index < matrix.length; index += 1) {
            const source = matrix[index] ?? [];
            const raw = Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, source[columnIndex.get(column) ?? -1]]));
            const name = cleanText(raw.Nome);
            const phone = cleanPhone(raw.Telefone);
            const address = cleanText(raw.Endereco);
            const latitude = numberOrNull(raw.Latitude);
            const longitude = numberOrNull(raw.Longitude);
            const googleMapsLink = cleanText(raw.LinkGoogleMaps);
            const isBlank = !name && !phone && !address && !googleMapsLink;
            if (isBlank) continue;

            const validationErrors: string[] = [];
            if (missing.length) validationErrors.push(`Columnas faltantes: ${missing.join(", ")}`);
            if (!name) validationErrors.push("Falta Nome");
            if (!phoneDigits(phone) && !googleMapsLink && !address) validationErrors.push("Sin contacto o ubicacion");
            if ((latitude == null) !== (longitude == null)) validationErrors.push("Coordenadas incompletas");

            rows.push({
                rowNumber: index + 1,
                categoryName: cleanText(sheetName) || "Sin categoria",
                name,
                phone,
                address,
                latitude,
                longitude,
                googleMapsLink,
                dedupeKeys: buildDedupeKeys({ name, phone, address, googleMapsLink }),
                validationErrors,
            });
        }
    }

    const seen = new Set<string>();
    const existing = await findExistingCommercialDuplicateKeys(rows.flatMap((row) => row.dedupeKeys));
    const enriched = rows.map((row) => {
        const duplicate = row.dedupeKeys.some((key) => seen.has(key) || existing.has(key));
        row.dedupeKeys.forEach((key) => seen.add(key));
        return duplicate ? { ...row, validationErrors: [...row.validationErrors, "Duplicado"] } : row;
    });

    const categories = Array.from(new Set(enriched.map((row) => row.categoryName))).map((name) => {
        const items = enriched.filter((row) => row.categoryName === name);
        return {
            name,
            total: items.length,
            valid: items.filter((row) => row.validationErrors.length === 0).length,
            invalid: items.filter((row) => row.validationErrors.length > 0).length,
        };
    });

    return {
        fileName: file.name,
        rows: enriched,
        categories,
        totalRows: enriched.length,
        validRows: enriched.filter((row) => row.validationErrors.length === 0).length,
        invalidRows: enriched.filter((row) => row.validationErrors.length > 0 && !row.validationErrors.includes("Duplicado")).length,
        duplicateRows: enriched.filter((row) => row.validationErrors.includes("Duplicado")).length,
    };
}

export default function CommercialDirectoryPage() {
    const canView = useCan("commercialDirectoryView");
    const canEdit = useCan("commercialDirectoryEdit");
    const { profile } = useAuth();
    const [locations, setLocations] = useState<CommercialDirectoryLocationDoc[]>([]);
    const [categories, setCategories] = useState<CommercialDirectoryCategoryDoc[]>([]);
    const [prospects, setProspects] = useState<CommercialDirectoryProspectDoc[]>([]);
    const [imports, setImports] = useState<CommercialDirectoryImportDoc[]>([]);
    const [countryId, setCountryId] = useState("");
    const [cityId, setCityId] = useState("");
    const [neighborhoodId, setNeighborhoodId] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [folderCountry, setFolderCountry] = useState("Brasil");
    const [folderCity, setFolderCity] = useState("");
    const [folderNeighborhood, setFolderNeighborhood] = useState("");
    const [preview, setPreview] = useState<CommercialDirectoryImportPreview | null>(null);
    const [parsing, setParsing] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState("");

    const countries = useMemo(() => locations.filter((item) => item.type === "country"), [locations]);
    const cities = useMemo(() => locations.filter((item) => item.type === "city" && item.parentId === countryId), [locations, countryId]);
    const neighborhoods = useMemo(() => locations.filter((item) => item.type === "neighborhood" && item.parentId === cityId), [locations, cityId]);
    const selectedCountry = countries.find((item) => item.id === countryId) ?? null;
    const selectedCity = cities.find((item) => item.id === cityId) ?? null;
    const selectedNeighborhood = neighborhoods.find((item) => item.id === neighborhoodId) ?? null;
    const selectedCategory = categories.find((item) => item.id === categoryId) ?? null;
    const selectedPath = [selectedCountry?.name, selectedCity?.name, selectedNeighborhood?.name].filter(Boolean).join(" / ");

    const stats = useMemo(() => ({
        countries: countries.length,
        neighborhoods: locations.filter((item) => item.type === "neighborhood").length,
        categories: categories.length,
        prospects: prospects.length,
    }), [countries.length, locations, categories.length, prospects.length]);

    async function loadAll() {
        setLoading(true);
        setError(null);
        try {
            const [nextLocations, nextImports] = await Promise.all([
                listDirectoryLocations(),
                listDirectoryImports(),
            ]);
            setLocations(nextLocations);
            setImports(nextImports);
            setCountryId((current) => current || nextLocations.find((item) => item.type === "country")?.id || "");
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo cargar el directorio.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        queueMicrotask(() => {
            void loadAll();
        });
    }, []);

    useEffect(() => {
        if (!countryId || cities.some((item) => item.id === cityId)) return;
        queueMicrotask(() => setCityId(cities[0]?.id || ""));
    }, [countryId, cities, cityId]);

    useEffect(() => {
        if (!cityId || neighborhoods.some((item) => item.id === neighborhoodId)) return;
        queueMicrotask(() => setNeighborhoodId(neighborhoods[0]?.id || ""));
    }, [cityId, neighborhoods, neighborhoodId]);

    useEffect(() => {
        queueMicrotask(() => {
            setCategoryId("");
            setCategories([]);
            setProspects([]);
        });
        if (!neighborhoodId) return;
        void listDirectoryCategories(neighborhoodId)
            .then(setCategories)
            .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar las categorias."));
    }, [neighborhoodId]);

    useEffect(() => {
        if (!neighborhoodId) return;
        void listDirectoryProspects({ neighborhoodId, categoryId })
            .then(setProspects)
            .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar los prospectos."));
    }, [neighborhoodId, categoryId]);

    async function handleCreateLocation() {
        if (!canEdit) return;
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const created = await createDirectoryLocation({
                countryName: folderCountry,
                cityName: folderCity,
                neighborhoodName: folderNeighborhood,
            });
            await loadAll();
            setCountryId(created.countryId);
            setCityId(created.cityId);
            setNeighborhoodId(created.neighborhoodId);
            setCreateOpen(false);
            setMessage("Carpeta creada.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo crear la carpeta.");
        } finally {
            setSaving(false);
        }
    }

    async function handleFile(file?: File | null) {
        if (!file) return;
        setParsing(true);
        setError(null);
        setMessage(null);
        try {
            setPreview(await parseWorkbook(file));
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo leer el Excel.");
        } finally {
            setParsing(false);
        }
    }

    async function handleImport() {
        if (!canEdit || !preview || !selectedCountry || !selectedCity || !selectedNeighborhood || !profile) return;
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const result = await importCommercialDirectory({
                fileName: preview.fileName,
                countryName: selectedCountry.name,
                cityName: selectedCity.name,
                neighborhoodName: selectedNeighborhood.name,
                rows: preview.rows,
                importedBy: profile.id,
                importedByName: profile.name || profile.email || "Admin",
            });
            setPreview(null);
            await loadAll();
            setCountryId(result.countryId);
            setCityId(result.cityId);
            setNeighborhoodId(result.neighborhoodId);
            setMessage(`${result.insertedCount} prospectos importados.`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo importar el archivo.");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!canEdit || !deleteTarget || !selectedCountry || !selectedCity) return;
        const expected = deleteLabel(deleteTarget, selectedCity, selectedNeighborhood, selectedCategory);
        if (deleteConfirm.trim() !== expected) {
            setError(`Escribe "${expected}" para confirmar.`);
            return;
        }

        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            if (deleteTarget === "category") {
                if (!selectedCategory || !selectedNeighborhood) throw new Error("Selecciona una categoria.");
                const result = await deleteCommercialDirectoryCategory({
                    categoryId: selectedCategory.id,
                    neighborhoodId: selectedNeighborhood.id,
                    cityId: selectedCity.id,
                    countryId: selectedCountry.id,
                    prospectCount: categoryCount(selectedCategory),
                });
                setMessage(`Categoria eliminada. ${result.deletedProspects} prospectos borrados.`);
            }

            if (deleteTarget === "neighborhood") {
                if (!selectedNeighborhood) throw new Error("Selecciona un barrio.");
                const result = await deleteCommercialDirectoryNeighborhood({
                    neighborhoodId: selectedNeighborhood.id,
                    cityId: selectedCity.id,
                    countryId: selectedCountry.id,
                });
                setMessage(`Barrio eliminado. ${result.deletedCategories} categorias y ${result.deletedProspects} prospectos borrados.`);
            }

            if (deleteTarget === "city") {
                const result = await deleteCommercialDirectoryCity({
                    cityId: selectedCity.id,
                    countryId: selectedCountry.id,
                });
                setMessage(`Ciudad eliminada. ${result.deletedNeighborhoods} barrios, ${result.deletedCategories} categorias y ${result.deletedProspects} prospectos borrados.`);
            }

            setDeleteTarget(null);
            setDeleteConfirm("");
            setCategoryId("");
            setNeighborhoodId("");
            setCityId("");
            await loadAll();
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo eliminar la base.");
        } finally {
            setSaving(false);
        }
    }

    if (!canView) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
                <AppIcon name="lock" tone="red" size="lg" />
                <p className="text-[16px] font-black text-[#101936]">Sin permisos</p>
                <p className="max-w-xs text-[13px] font-semibold text-[#66739A]">No tienes acceso al Directorio Comercial. Contacta al superadmin.</p>
            </div>
        );
    }

    return (
        <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 pb-4">
            <PageHeader
                title="Directorio Comercial"
                subtitle="Base de prospectos frios por pais, ciudad, barrio y categoria."
                icon={<AppIcon name="map" plain className="h-5 w-5 text-current" />}
                actions={
                    <div className="flex gap-2">
                        {canEdit ? <IconButton icon="plus" label="Crear estructura" variant="primary" onClick={() => setCreateOpen(true)} /> : null}
                        <IconButton icon="refresh" label="Actualizar" variant="primary" onClick={loadAll} disabled={loading} />
                    </div>
                }
            />

            {error ? <Notice tone="red">{error}</Notice> : null}
            {message ? <Notice tone="green">{message}</Notice> : null}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Paises" value={stats.countries} caption="Carpetas raiz" icon="map" tone="blue" />
                <KpiCard label="Barrios" value={stats.neighborhoods} caption="Zonas disponibles" icon="location" tone="green" />
                <KpiCard label="Categorias" value={stats.categories} caption="Del barrio activo" icon="filter" tone="purple" />
                <KpiCard label="Prospectos" value={stats.prospects} caption="Vista actual" icon="lead" tone="orange" />
            </section>

            <section className="space-y-4">
                <Card className="p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <h2 className="text-[14px] font-black text-[#101936]">Carpeta de trabajo</h2>
                            <p className="mt-1 text-[12px] font-semibold text-[#66739A]">
                                Todo Excel se guardara exactamente en el pais, ciudad y barrio seleccionados aqui.
                            </p>
                        </div>
                        {selectedPath ? (
                            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-black text-blue-700">
                                Destino activo: {selectedPath}
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <SelectField label="Pais" value={countryId} onChange={(value) => setCountryId(value)}>
                            <option value="">Seleccionar pais...</option>
                            {countries.map((item) => <option key={item.id} value={item.id}>{item.name} ({locationCount(item)})</option>)}
                        </SelectField>

                        <SelectField label="Ciudad" value={cityId} onChange={(value) => setCityId(value)} disabled={!countryId}>
                            <option value="">Seleccionar ciudad...</option>
                            {cities.map((item) => <option key={item.id} value={item.id}>{item.name} ({locationCount(item)})</option>)}
                        </SelectField>

                        <SelectField label="Barrio / Zona" value={neighborhoodId} onChange={(value) => setNeighborhoodId(value)} disabled={!cityId}>
                            <option value="">Seleccionar barrio...</option>
                            {neighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name} ({locationCount(item)})</option>)}
                        </SelectField>

                        <SelectField label="Categoria" value={categoryId} onChange={(value) => setCategoryId(value)} disabled={!neighborhoodId}>
                            <option value="">Todas las categorias</option>
                            {categories.map((item) => <option key={item.id} value={item.id}>{item.name} ({categoryCount(item)})</option>)}
                        </SelectField>
                    </div>

                    {canEdit ? (
                        <div className="mt-4 flex flex-col gap-2 border-t border-[#eef1f5] pt-4 sm:flex-row sm:flex-wrap">
                            <Button variant="danger" onClick={() => setDeleteTarget("city")} disabled={!selectedCity || saving}>
                                Eliminar ciudad
                            </Button>
                            <Button variant="danger" onClick={() => setDeleteTarget("neighborhood")} disabled={!selectedNeighborhood || saving}>
                                Eliminar barrio
                            </Button>
                            <Button variant="danger" onClick={() => setDeleteTarget("category")} disabled={!selectedCategory || saving}>
                                Eliminar categoria
                            </Button>
                        </div>
                    ) : null}
                </Card>

                <div className="space-y-4">
                    {canEdit ? (
                        <Card className="p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h2 className="text-[14px] font-black text-[#101936]">Importar Excel</h2>
                                    <p className="mt-1 text-[12px] font-semibold text-[#66739A]">Cada hoja crea una categoria automaticamente.</p>
                                </div>
                                <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[14px] border border-[#ded8ff] bg-white px-3 py-2 text-[12px] font-bold text-[#312e81] shadow-sm transition hover:bg-[#f8f7ff]">
                                    {parsing ? "Leyendo..." : "Seleccionar .xlsx"}
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls"
                                        className="hidden"
                                        disabled={!selectedNeighborhood || parsing}
                                        onChange={(event) => void handleFile(event.target.files?.[0])}
                                    />
                                </label>
                            </div>

                            {!selectedNeighborhood ? (
                                <p className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-[12px] font-bold text-yellow-700">
                                    Selecciona pais, ciudad y barrio antes de importar.
                                </p>
                            ) : (
                                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-700">
                                    Esta base se guardara en: {selectedPath}. Las hojas del Excel se crearan como categorias dentro de este barrio.
                                </div>
                            )}

                            {preview ? (
                                <div className="mt-4 space-y-3">
                                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] font-bold text-blue-700">
                                        Archivo: {preview.fileName}. Destino confirmado: {selectedPath}.
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-4">
                                        <MiniStat label="Filas" value={preview.totalRows} />
                                        <MiniStat label="Validas" value={preview.validRows} />
                                        <MiniStat label="Duplicadas" value={preview.duplicateRows} />
                                        <MiniStat label="Errores" value={preview.invalidRows} />
                                    </div>

                                    <div className="overflow-hidden rounded-xl border border-[#e4e7ec]">
                                        <table className="w-full text-left text-[12px]">
                                            <thead className="bg-[#f8f7ff] text-[#66739A]">
                                                <tr>
                                                    <th className="px-3 py-2 font-black">Categoria</th>
                                                    <th className="px-3 py-2 font-black">Total</th>
                                                    <th className="px-3 py-2 font-black">Validas</th>
                                                    <th className="px-3 py-2 font-black">Errores</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#eef1f5] bg-white">
                                                {preview.categories.map((item) => (
                                                    <tr key={item.name}>
                                                        <td className="px-3 py-2 font-bold text-[#101936]">{item.name}</td>
                                                        <td className="px-3 py-2 font-semibold text-[#66739A]">{item.total}</td>
                                                        <td className="px-3 py-2 font-semibold text-emerald-600">{item.valid}</td>
                                                        <td className="px-3 py-2 font-semibold text-red-600">{item.invalid}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                                        <Button variant="ghost" onClick={() => setPreview(null)} disabled={saving}>Cancelar</Button>
                                        <Button variant="primary" onClick={handleImport} disabled={saving || preview.validRows === 0}>
                                            {saving ? "Importando..." : `Importar ${preview.validRows}`}
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </Card>
                    ) : null}

                    <Card className="overflow-hidden">
                        <div className="flex flex-col gap-2 border-b border-[#eef1f5] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-[14px] font-black text-[#101936]">Prospectos</h2>
                                <p className="text-[12px] font-semibold text-[#66739A]">
                                    {selectedNeighborhood ? `${selectedNeighborhood.name}${selectedCategory ? ` - ${selectedCategory.name}` : ""}` : "Selecciona una carpeta"}
                                </p>
                            </div>
                            <Badge tone="purple">{prospects.length} visibles</Badge>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-[12px]">
                                <thead className="bg-[#f8f7ff] text-[#66739A]">
                                    <tr>
                                        <th className="px-4 py-3 font-black">Nombre</th>
                                        <th className="px-4 py-3 font-black">Telefono</th>
                                        <th className="px-4 py-3 font-black">Direccion</th>
                                        <th className="px-4 py-3 font-black">Categoria</th>
                                        <th className="px-4 py-3 font-black">Estado</th>
                                        <th className="px-4 py-3 font-black">Maps</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#eef1f5] bg-white">
                                    {prospects.map((item) => (
                                        <tr key={item.id}>
                                            <td className="px-4 py-3 font-bold text-[#101936]">{item.name}</td>
                                            <td className="px-4 py-3 font-semibold text-[#344054]">{item.phone || "-"}</td>
                                            <td className="max-w-[260px] truncate px-4 py-3 font-semibold text-[#66739A]">{item.address || "-"}</td>
                                            <td className="px-4 py-3 font-semibold text-[#344054]">{item.categoryName}</td>
                                            <td className="px-4 py-3"><Badge tone="blue">Nuevo</Badge></td>
                                            <td className="px-4 py-3">
                                                {item.googleMapsLink ? (
                                                    <a href={item.googleMapsLink} target="_blank" rel="noreferrer" className="font-black text-[#4f46e5]">Abrir</a>
                                                ) : "-"}
                                            </td>
                                        </tr>
                                    ))}
                                    {!prospects.length ? (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-10 text-center font-bold text-[#98A2B3]">
                                                {loading ? "Cargando..." : "No hay prospectos en esta vista."}
                                            </td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    <Card className="p-4">
                        <h2 className="text-[14px] font-black text-[#101936]">Ultimas importaciones</h2>
                        <div className="mt-3 grid gap-2">
                            {imports.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#eef1f5] bg-white px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-[12px] font-black text-[#101936]">{item.fileName}</p>
                                        <p className="text-[11px] font-semibold text-[#66739A]">{item.neighborhoodName} - {item.insertedCount} importados</p>
                                    </div>
                                    <Badge tone={item.duplicateCount ? "yellow" : "green"}>{item.duplicateCount} dup.</Badge>
                                </div>
                            ))}
                            {!imports.length ? <p className="text-[12px] font-bold text-[#98A2B3]">Sin importaciones todavia.</p> : null}
                        </div>
                    </Card>
                </div>
            </section>

            <Modal
                open={createOpen}
                title="Crear estructura"
                subtitle="Crea una carpeta de pais, ciudad y barrio para guardar bases comerciales."
                onClose={() => setCreateOpen(false)}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Pais">
                            <Input value={folderCountry} onChange={(e) => setFolderCountry(e.target.value)} />
                        </Field>
                        <Field label="Ciudad">
                            <Input value={folderCity} onChange={(e) => setFolderCity(e.target.value)} placeholder="Ej: Belem" />
                        </Field>
                    </div>
                    <Field label="Barrio / Zona">
                        <Input value={folderNeighborhood} onChange={(e) => setFolderNeighborhood(e.target.value)} placeholder="Ej: Sacramenta" />
                    </Field>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-bold text-blue-700">
                        Las categorias no se crean aqui: se generan automaticamente con las hojas del Excel.
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancelar</Button>
                        <Button variant="primary" onClick={handleCreateLocation} disabled={saving}>{saving ? "Guardando..." : "Crear estructura"}</Button>
                    </div>
                </div>
            </Modal>

            <Modal
                open={deleteTarget != null}
                title="Eliminar base"
                subtitle="Esta accion borra en cascada los datos dentro de la carpeta seleccionada."
                onClose={() => {
                    setDeleteTarget(null);
                    setDeleteConfirm("");
                }}
            >
                <div className="space-y-4">
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-[12px] font-bold text-red-700">
                        Vas a eliminar: {deleteTarget ? deleteDescription(deleteTarget, selectedCity, selectedNeighborhood, selectedCategory) : ""}.
                        Tambien se borraran los prospectos guardados dentro.
                    </div>
                    <Field label={`Escribe "${deleteTarget ? deleteLabel(deleteTarget, selectedCity, selectedNeighborhood, selectedCategory) : ""}" para confirmar`}>
                        <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
                    </Field>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setDeleteTarget(null);
                                setDeleteConfirm("");
                            }}
                            disabled={saving}
                        >
                            Cancelar
                        </Button>
                        <Button variant="danger" onClick={handleDelete} disabled={saving || !deleteTarget}>
                            {saving ? "Eliminando..." : "Eliminar definitivamente"}
                        </Button>
                    </div>
                </div>
            </Modal>
        </main>
    );
}

function deleteLabel(
    target: DeleteTarget,
    city?: CommercialDirectoryLocationDoc | null,
    neighborhood?: CommercialDirectoryLocationDoc | null,
    category?: CommercialDirectoryCategoryDoc | null
) {
    if (target === "category") return category?.name ?? "";
    if (target === "neighborhood") return neighborhood?.name ?? "";
    return city?.name ?? "";
}

function deleteDescription(
    target: DeleteTarget,
    city?: CommercialDirectoryLocationDoc | null,
    neighborhood?: CommercialDirectoryLocationDoc | null,
    category?: CommercialDirectoryCategoryDoc | null
) {
    if (target === "category") return `categoria ${category?.name ?? ""} en ${neighborhood?.name ?? ""}`;
    if (target === "neighborhood") return `barrio ${neighborhood?.name ?? ""} completo`;
    return `ciudad ${city?.name ?? ""} completa`;
}

function Notice({ tone, children }: { tone: "red" | "green"; children: string }) {
    return (
        <div className={[
            "rounded-xl border px-4 py-3 text-[13px] font-bold",
            tone === "red" ? "border-red-200 bg-red-50 text-red-600" : "border-emerald-200 bg-emerald-50 text-emerald-700",
        ].join(" ")}>
            {children}
        </div>
    );
}

function SelectField({
    label,
    value,
    disabled,
    children,
    onChange,
}: {
    label: string;
    value: string;
    disabled?: boolean;
    children: ReactNode;
    onChange: (value: string) => void;
}) {
    return (
        <Field label={label}>
            <select
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                className="h-10 w-full rounded-[15px] border border-[#e4e7ec] bg-white px-3 text-[13px] font-bold text-[#344054] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-blue-100 disabled:bg-[#f2f4f7] disabled:text-[#98A2B3]"
            >
                {children}
            </select>
        </Field>
    );
}

function MiniStat({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl border border-[#e4e7ec] bg-[#fbfcff] px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.06em] text-[#66739A]">{label}</p>
            <p className="mt-1 font-mono text-[20px] font-black text-[#101936]">{value}</p>
        </div>
    );
}
