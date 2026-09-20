import { BulkUnitStatus } from "@prisma/client";
import { effectiveBulkUnitStatus } from "@/lib/bulk-unit-status";

type UnitStatusLike = BulkUnitStatus | `${BulkUnitStatus}`;

type UnitLike = {
  id: string;
  status: UnitStatusLike;
};

type BalanceLike = {
  onHandQuantity: number;
};

type ItemFamilyLike<TUnit extends UnitLike> = {
  trackByNumber: boolean;
  units: TUnit[];
  balances: BalanceLike[];
};

type EffectiveItemFamilyUnit<TUnit extends UnitLike> = Omit<TUnit, "status"> & {
  status: BulkUnitStatus;
};

type ItemFamilyState<TUnit extends UnitLike> = {
  effectiveUnits: Array<EffectiveItemFamilyUnit<TUnit>>;
  balanceOnHandQuantity: number;
  onHandQuantity: number;
  availableQuantity: number;
  checkedOutQuantity: number;
  lostQuantity: number;
  retiredQuantity: number;
};

export function summarizeItemFamilyState<TUnit extends UnitLike>(
  sku: ItemFamilyLike<TUnit>,
  activeAllocationByUnitId: Map<string, unknown>,
): ItemFamilyState<TUnit> {
  const balanceOnHandQuantity = sku.balances.reduce((sum, balance) => sum + balance.onHandQuantity, 0);
  const effectiveUnits = sku.units.map((unit) => ({
    ...unit,
    status: effectiveBulkUnitStatus(unit, activeAllocationByUnitId.get(unit.id)),
  })) as Array<EffectiveItemFamilyUnit<TUnit>>;

  if (!sku.trackByNumber) {
    const availableQuantity = Math.max(0, balanceOnHandQuantity);
    return {
      effectiveUnits,
      balanceOnHandQuantity,
      onHandQuantity: availableQuantity,
      availableQuantity,
      checkedOutQuantity: 0,
      lostQuantity: 0,
      retiredQuantity: 0,
    };
  }

  return {
    effectiveUnits,
    balanceOnHandQuantity,
    onHandQuantity: effectiveUnits.filter((unit) => unit.status !== BulkUnitStatus.RETIRED).length,
    availableQuantity: countUnits(effectiveUnits, BulkUnitStatus.AVAILABLE),
    checkedOutQuantity: countUnits(effectiveUnits, BulkUnitStatus.CHECKED_OUT),
    lostQuantity: countUnits(effectiveUnits, BulkUnitStatus.LOST),
    retiredQuantity: countUnits(effectiveUnits, BulkUnitStatus.RETIRED),
  };
}

function countUnits<TUnit extends UnitLike>(
  units: Array<EffectiveItemFamilyUnit<TUnit>>,
  status: BulkUnitStatus,
) {
  return units.filter((unit) => unit.status === status).length;
}
