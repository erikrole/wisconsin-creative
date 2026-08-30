import type { CategoryOption } from "@/types/category";
import type { Location, Department } from "@/types/common";
export type { Location, Department };

export type ParentSearchResult = {
  id: string;
  assetTag: string;
  name: string | null;
  brand: string;
  model: string;
};

export type ItemKind = "standard" | "units" | "quantity";
export type BulkMode = "new" | "existing";

export type FormValidationIssue = {
  message: string;
  fieldId: string;
};

export type RequiredFieldProgress = {
  completed: number;
  total: number;
};

export type SerializedIntakeTemplate = {
  key: string;
  sourceAssetId?: string;
  batchSize?: number;
  sourceLabel: string;
  productLabel: string;
  assetTag: string;
  name: string;
  brand: string;
  model: string;
  categoryId: string;
  locationId: string;
  departmentId: string;
  linkUrl: string;
  availableForReservation: boolean;
  availableForCheckout: boolean;
  availableForCustody: boolean;
};

export interface NewItemSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
  departments: Department[];
  categories: CategoryOption[];
  onCreated: () => void;
  sourceAssetId?: string | null;
}
