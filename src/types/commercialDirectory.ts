export type CommercialDirectoryProspectStatus =
    | "new"
    | "assigned"
    | "contacted"
    | "interested"
    | "not_interested"
    | "no_response"
    | "converted"
    | "discarded";

export type CommercialDirectoryLocationType = "country" | "city" | "neighborhood";

export type CommercialDirectoryLocationDoc = {
    id: string;
    type: CommercialDirectoryLocationType;
    name: string;
    normalizedName: string;
    parentId: string | null;
    pathIds: string[];
    countryId?: string;
    cityId?: string;
    prospectCount: number;
    categoryCount: number;
    createdAt: number;
    updatedAt: number;
};

export type CommercialDirectoryCategoryDoc = {
    id: string;
    name: string;
    normalizedName: string;
    countryId: string;
    cityId: string;
    neighborhoodId: string;
    prospectCount: number;
    createdAt: number;
    updatedAt: number;
};

export type CommercialDirectoryProspectDoc = {
    id: string;
    name: string;
    phone: string;
    phoneDigits: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    googleMapsLink: string;
    status: CommercialDirectoryProspectStatus;
    source: "public_import";
    importId: string;
    sourceFileName: string;
    countryId: string;
    countryName: string;
    cityId: string;
    cityName: string;
    neighborhoodId: string;
    neighborhoodName: string;
    categoryId: string;
    categoryName: string;
    dedupeKeys: string[];
    assignedTo: string | null;
    assignedAt: number | null;
    contactedAt: number | null;
    convertedClientId: string | null;
    importedBy: string;
    importedByName: string;
    createdAt: number;
    updatedAt: number;
};

export type CommercialDirectoryImportDoc = {
    id: string;
    fileName: string;
    countryId: string;
    countryName: string;
    cityId: string;
    cityName: string;
    neighborhoodId: string;
    neighborhoodName: string;
    categoryNames: string[];
    totalRows: number;
    insertedCount: number;
    duplicateCount: number;
    invalidCount: number;
    importedBy: string;
    importedByName: string;
    createdAt: number;
};

export type CommercialDirectoryParsedRow = {
    rowNumber: number;
    categoryName: string;
    name: string;
    phone: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    googleMapsLink: string;
    dedupeKeys: string[];
    validationErrors: string[];
};

export type CommercialDirectoryImportPreview = {
    fileName: string;
    rows: CommercialDirectoryParsedRow[];
    categories: { name: string; total: number; valid: number; invalid: number }[];
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
};
