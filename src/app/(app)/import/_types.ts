export type ColumnMapping = Record<string, string>;

type PreviewRow = {
  line: number;
  assetTag: string;
  assetTagDeduped: boolean;
  name: string;
  type: string;
  brand: string;
  model: string;
  serialNumber: string;
  locationName: string;
  departmentName: string;
  kitName: string;
  uwAssetTag: string;
  consumable: boolean;
  retired: boolean;
  warnings: string[];
  errors: string[];
  action?: string;
};

type PreviewSummary = {
  totalItems: number;
  willCreate: number;
  willUpdate: number;
  withErrors: number;
  withWarnings: number;
  duplicateNames: number;
  consumableItems: number;
  retiredItems: number;
  locations: string[];
  newLocations: string[];
  departments: string[];
  newDepartments: string[];
  kits: string[];
};

export type PreviewData = {
  headers: string[];
  totalRows: number;
  rows: PreviewRow[];
  mapping: ColumnMapping;
  summary: PreviewSummary;
};

export type ImportResult = {
  created: number;
  updated: number;
  bulkCreated: number;
  skipped: number;
  kitsCreated: number;
  imagesQueued: number;
  errors: Array<{ line: number; assetTag: string; error: string }>;
};

export type Step = "upload" | "mapping" | "preview" | "importing" | "summary";

export const FIELD_OPTIONS = [
  { value: "__skip__", label: "\u2014 Skip \u2014" },
  { value: "assetTag", label: "Asset Tag / Name" },
  { value: "type", label: "Category / Type" },
  { value: "brand", label: "Brand" },
  { value: "model", label: "Model" },
  { value: "serialNumber", label: "Serial Number" },
  { value: "locationName", label: "Location" },
  { value: "department", label: "Department" },
  { value: "kitName", label: "Kit" },
  { value: "purchaseDate", label: "Purchase Date" },
  { value: "purchasePrice", label: "Purchase Price" },
  { value: "warrantyDate", label: "Warranty Date" },
  { value: "residualValue", label: "Residual Value" },
  { value: "imageUrl", label: "Image URL" },
  { value: "uwAssetTag", label: "UW Asset Tag" },
  { value: "codes", label: "Codes" },
  { value: "barcodes", label: "Barcodes" },
  { value: "sourceId", label: "Source ID" },
  { value: "retired", label: "Retired" },
  { value: "link", label: "Link / URL" },
  { value: "description", label: "Description" },
  { value: "owner", label: "Owner" },
  { value: "fiscalYear", label: "Fiscal Year" },
  { value: "kind", label: "Kind (Individual/Bulk)" },
  { value: "quantity", label: "Quantity" },
];

export const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "mapping", label: "Map columns" },
  { key: "preview", label: "Preview" },
  { key: "importing", label: "Import" },
  { key: "summary", label: "Summary" },
];

export const VARIANT_COLORS: Record<string, string> = {
  green: "text-green-600 dark:text-green-400",
  blue: "text-blue-600 dark:text-blue-400",
  red: "text-destructive",
  purple: "text-purple-600 dark:text-purple-400",
};
