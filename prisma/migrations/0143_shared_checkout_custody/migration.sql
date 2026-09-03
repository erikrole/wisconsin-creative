-- The deployed EVENT scope was never used by application code. Product
-- direction now models travel cases and truck manifests as generic shared
-- custody, with personally carried gear kept on separate personal checkouts.
ALTER TYPE "BookingCustodyScope" RENAME VALUE 'EVENT' TO 'SHARED';
