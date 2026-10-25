type BulkSkuProductIdentity = {
  id: string;
  name: string;
  brand: string;
  model: string | null;
  active: boolean;
};

export type BulkSkuProduct = BulkSkuProductIdentity & {
  _count: { units: number };
};

export type BulkUnit = {
  id: string;
  productId: string | null;
  unitNumber: number;
  status: "AVAILABLE" | "CHECKED_OUT" | "LOST" | "RETIRED";
  notes: string | null;
  labelPrintedAt?: string | null;
  labelPrintedById?: string | null;
  labelPrintBatchId?: string | null;
  product: BulkSkuProductIdentity | null;
  allocations?: Array<{
    bookingBulkItem: {
      booking: { refNumber: string | null; title: string; requester: { name: string } };
    };
  }>;
};

export type BulkSkuDetail = {
  id: string;
  name: string;
  category: string;
  unit: string;
  binQrCodeValue: string;
  minThreshold: number;
  trackByNumber: boolean;
  purchasePrice: string | null;
  purchaseLink: string | null;
  notes: string | null;
  imageUrl: string | null;
  active: boolean;
  onHand: number;
  availableQuantity: number;
  location: { id: string; name: string };
  categoryRel: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  balances: Array<{ onHandQuantity: number }>;
  products: BulkSkuProduct[];
  units: BulkUnit[];
};
