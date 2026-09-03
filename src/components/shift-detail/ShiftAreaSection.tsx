import { AddSlotMenu, CrewAreaHeading } from "./crew-row";
import { ShiftSlotCard } from "./ShiftSlotCard";
import type { PickerUser } from "./UserAvatarPicker";

type ShiftUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type ShiftAssignment = {
  id: string;
  status: string;
  hasConflict?: boolean;
  conflictNote?: string | null;
  attended?: boolean | null;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  callNote?: string | null;
  user: ShiftUser;
};

type Shift = {
  id: string;
  area: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  notes: string | null;
  assignments: ShiftAssignment[];
};

type Props = {
  area: string;
  shifts: Shift[];
  eventAllDay?: boolean;
  studentCallTimeAllowed?: boolean;
  isStaff: boolean;
  canReviewClaims?: boolean;
  canEdit?: boolean;
  currentUserId?: string;
  acting: string | null;
  pickerShiftId: string | null;
  pickerUsers: PickerUser[];
  pickerLoading: boolean;
  pickerSearch: string;
  onPickerSearchChange: (value: string) => void;
  onOpenPicker: (shiftId: string) => void;
  onClosePicker: () => void;
  onAddShift: (workerType: "FT" | "ST") => void;
  onDeleteShift: (shiftId: string, hasAssignment: boolean) => void;
  onAssign: (shiftId: string, userId: string) => void;
  onRemove: (assignmentId: string) => void;
  onApprove: (assignmentId: string) => void;
  onDecline: (assignmentId: string) => void;
  onPostTrade?: (assignmentId: string) => void;
  onCallWindowSaved?: () => void;
};

export function ShiftAreaSection({
  area,
  shifts,
  eventAllDay = false,
  studentCallTimeAllowed = true,
  isStaff,
  canReviewClaims = false,
  canEdit = isStaff,
  currentUserId,
  acting,
  pickerShiftId,
  pickerUsers,
  pickerLoading,
  pickerSearch,
  onPickerSearchChange,
  onOpenPicker,
  onClosePicker,
  onAddShift,
  onDeleteShift,
  onAssign,
  onRemove,
  onApprove,
  onDecline,
  onPostTrade,
  onCallWindowSaved,
}: Props) {
  return (
    <div className="mt-4">
      <CrewAreaHeading
        className="mb-2"
        area={area}
        filled={shifts.filter((shift) => shift.assignments.some(
          (a) => a.status === "DIRECT_ASSIGNED" || a.status === "APPROVED",
        )).length}
        total={shifts.length}
        action={canEdit ? (
          <AddSlotMenu area={area} disabled={acting !== null} onAdd={onAddShift} />
        ) : undefined}
      />

      {shifts.length === 0 ? (
        <p className="mb-2 text-sm text-muted-foreground">No shifts configured</p>
      ) : (
        shifts.map((shift) => {
          const activeAssignment = shift.assignments.find(
            (a) => a.status === "DIRECT_ASSIGNED" || a.status === "APPROVED"
          );
          const pendingRequests = shift.assignments.filter(
            (a) => a.status === "REQUESTED"
          );

          return (
            <ShiftSlotCard
              key={shift.id}
              shiftId={shift.id}
              workerType={shift.workerType}
              startsAt={shift.startsAt}
              endsAt={shift.endsAt}
              callStartsAt={shift.callStartsAt ?? null}
              callEndsAt={shift.callEndsAt ?? null}
              eventAllDay={eventAllDay}
              studentCallTimeAllowed={studentCallTimeAllowed}
              activeAssignment={activeAssignment ?? null}
              pendingRequests={pendingRequests}
              isStaff={isStaff}
              canReviewClaims={canReviewClaims}
              canEdit={canEdit}
              currentUserId={currentUserId}
              acting={acting}
              pickerOpen={pickerShiftId === shift.id}
              pickerUsers={pickerUsers}
              pickerLoading={pickerLoading}
              pickerSearch={pickerSearch}
              onPickerSearchChange={onPickerSearchChange}
              onOpenPicker={() => onOpenPicker(shift.id)}
              onClosePicker={onClosePicker}
              onAssign={(userId) => onAssign(shift.id, userId)}
              onRemove={onRemove}
              onApprove={onApprove}
              onDecline={onDecline}
              onDeleteShift={() => onDeleteShift(shift.id, !!activeAssignment)}
              onPostTrade={onPostTrade}
              onCallWindowSaved={onCallWindowSaved}
            />
          );
        })
      )}
    </div>
  );
}
