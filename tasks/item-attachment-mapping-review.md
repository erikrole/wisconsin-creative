# Item Attachment Mapping Review

Created: 2026-06-26
Owner area: Items
Status: Physical review required before mutation — operator path is Cleanup wizard (`attachment_candidate`)

## Purpose

Finish the item-data cleanup by deciding which standalone camera/lens accessories should become child attachments. The data-only cleanup can attach rows only when the parent asset identity is provable from current fields. Everything below needs a physical shelf check or operator confirmation before changing `parentAssetId`. Prefer Items → Cleanup wizard → Attachment parents (`/items?cleanupWizard=attachment_candidate`) so attach/defer stays audited.

## Completed Safe Mapping

- `a7 V 2 Grip` is now attached to `A7 V 2`.
  - Evidence: child asset tag is an exact case-insensitive prefix match for the parent plus `Grip`.
  - Mutation: `parentAssetId` set to `A7 V 2`; checkout, reservation, and custody policy flags disabled on the child.

## Remaining Review Rows

| Child asset | Model | Current policy | History | Review decision needed |
|---|---:|---|---|---|
| `SmallRig Camera Cage Kit` | `4184` | checkout/reservation/custody enabled | no booking history | Attach to confirmed FX3/FX3A body, or keep standalone if staff checks it out independently. |
| `SmallRig Camera Cage Kit-1` | `4184` | checkout/reservation/custody enabled | no booking history | Attach to confirmed FX3/FX3A body, or keep standalone if staff checks it out independently. |
| `SmallRig Top Plate` | `MD3990` | checkout/reservation/custody enabled | no booking history | Attach to confirmed FX3/FX3A body, or keep standalone if shared rigging. |
| `SmallRig Top Plate-1` | `MD3990` | checkout/reservation/custody enabled | no booking history | Attach to confirmed FX3/FX3A body, or keep standalone if shared rigging. |
| `SmallRig Top Plate-2` | `MD3990` | checkout/reservation/custody enabled | one closed historical booking/allocation | Confirm whether past standalone use was cleanup noise or real independent checkout behavior before attaching. |
| `SmallRig Top Plate-3` | `MD3990` | checkout/reservation/custody enabled | no booking history | Attach to confirmed FX3/FX3A body, or keep standalone if shared rigging. |
| `Sony 67mm Front Lens Cap` | `ALCF67S` | checkout/reservation/custody enabled | no booking history | Attach to the exact 67mm lens currently missing this cap, or keep as family/spare if pooled. |
| `Sony 77mm Front Lens Cap` | `ALCF77S` | checkout/reservation/custody enabled | no booking history | Attach to the exact 77mm lens currently missing this cap, or keep as family/spare if pooled. |
| `Sony 82mm Front Lens Cap` | `ALCF82S` | checkout/reservation/custody enabled | no booking history | Attach to the exact 82mm lens currently missing this cap, or keep as family/spare if pooled. |
| `Sony Vertical Grip (FB1)` | `VG-C4EM` | checkout/reservation/custody enabled | no booking history | Confirm physical camera assignment. Likely Football body, but current data does not identify which one. |
| `Sony Vertical Grip (FB2)` | `VG-C5` | checkout/reservation/custody enabled | no booking history | Confirm physical camera assignment. Likely Football body, but current data does not identify which one. |
| `Sony Vertical Grip (MBB)` | `VG-C4EM` | checkout/reservation/custody enabled | no booking history | Confirm physical camera assignment. Likely MBB body, but current data does not identify which one. |

## Candidate Parent Pools

Camera bodies worth checking first:

- FX3/FX3A bodies: `FX3 1`, `FX3 2`, `FX3 3`, `FX3 4`, `FB FX3 1`, `FB FX3 2`.
- Football Sony bodies: `FB A7 IV 1`, `FB A7 V 1`, `FB a1 1`, `FB a1 II 1`, `FB a9 III 1`.
- MBB Sony body: `MBB A7 IV 1`.
- General Sony bodies: `A7 V 2`, `a7 V 1`, `a7 V 3`, `a1 II 1`, `a1 II 2`, `a7 III 1`, `a7S III 1`, `a7S III 2`.

Lens rows worth checking first:

- 67mm-cap candidates must be physically confirmed against the lens in hand. The current database does not store filter thread size.
- 77mm-cap candidates must be physically confirmed against the lens in hand. The current database does not store filter thread size.
- 82mm-cap candidates must be physically confirmed against the lens in hand. The current database does not store filter thread size.

## Apply Rule

For each confirmed attachment:

1. Set the child `Asset.parentAssetId` to the confirmed parent.
2. Set child `availableForCheckout`, `availableForReservation`, and `availableForCustody` to `false`.
3. Write an `AuditLog` row with before/after child policy and parent evidence.
4. Re-run `npm run cleanup:item-data` and `npm run audit:item-data`.

For each confirmed standalone/shared accessory:

1. Leave `parentAssetId` empty.
2. Keep checkout/reservation enabled only if staff intentionally checks it out independently.
3. Consider converting pooled spare lens caps into item families instead of serialized children if they are not married to a specific lens.
