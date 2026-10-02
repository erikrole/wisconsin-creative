import SwiftUI

/// The Schedule's filters, labelled and in view: whose events (Everyone or My
/// shifts), which sport, and which kind of event. Everything the list is
/// narrowed by stays visible here, so undoing one never means hunting for an
/// unlabelled toolbar icon.
struct ScheduleQuickFilterBar: View {
    @Binding var myShiftsOnly: Bool
    @Binding var sportFilter: String?
    let availableSportCodes: [String]
    @Binding var homeAwayFilter: HomeAwayFilter

    private static let allSports = "__all_sports__"

    private var showsSportMenu: Bool { availableSportCodes.count > 1 }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                scopeControl
                if showsSportMenu { sportMenu }
            }
            .padding(.horizontal, 16)

            // One flat segmented control, not a row of outlined chips.
            HStack(spacing: 2) {
                ForEach(HomeAwayFilter.allCases, id: \.self) { filter in
                    ScheduleFilterChip(
                        title: filter.rawValue,
                        isOn: homeAwayFilter == filter,
                        fillsWidth: true,
                        compact: true
                    ) {
                        homeAwayFilter = filter
                        Haptics.selection()
                    }
                }
            }
            .padding(3)
            .background(Capsule().fill(Color.flatRaised))
            .overlay(Capsule().strokeBorder(Color.flatStroke, lineWidth: 1))
            .padding(.horizontal, 16)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Event type")
        }
    }

    /// Everyone's events, or only the ones you work: the question most people
    /// open Schedule to answer, one tap, with both answers named.
    private var scopeControl: some View {
        HStack(spacing: 2) {
            ScheduleFilterChip(title: "Everyone", isOn: !myShiftsOnly, fillsWidth: true) {
                myShiftsOnly = false
                Haptics.selection()
            }
            ScheduleFilterChip(title: "My Shifts", isOn: myShiftsOnly, fillsWidth: true) {
                myShiftsOnly = true
                Haptics.selection()
            }
        }
        .padding(3)
        .background(Capsule().fill(Color.flatRaised))
        .overlay(Capsule().strokeBorder(Color.flatStroke, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Whose events")
    }

    private var sportSelection: Binding<String> {
        Binding {
            sportFilter ?? Self.allSports
        } set: { newValue in
            sportFilter = newValue == Self.allSports ? nil : newValue
        }
    }

    private var sportMenu: some View {
        Menu {
            Picker("Sport", selection: sportSelection) {
                Text("All Sports").tag(Self.allSports)
                ForEach(availableSportCodes, id: \.self) { code in
                    Text(scheduleSportLabel(code)).tag(code)
                }
            }
        } label: {
            HStack(spacing: 5) {
                Text(sportFilter.map(scheduleSportLabel) ?? "All sports")
                    .font(.subheadline.weight(sportFilter == nil ? .regular : .semibold))
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.primary)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Capsule().fill(sportFilter == nil ? Color.flatRaised : Color.flatCard))
            .overlay(
                Capsule().strokeBorder(sportFilter == nil ? Color.flatStroke : Color.primary, lineWidth: sportFilter == nil ? 1 : 1.5)
            )
            .contentShape(Capsule())
        }
        .accessibilityLabel(sportFilter.map { "Sport, " + scheduleSportLabel($0) } ?? "Sport, all sports")
    }
}

private struct ScheduleFilterChip: View {
    let title: String
    let isOn: Bool
    var fillsWidth = false
    /// Five segments share one row, so the type control sets its labels a
    /// size down rather than truncating "Non-game".
    var compact = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font((compact ? Font.footnote : Font.subheadline).weight(isOn ? .semibold : .regular))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .foregroundStyle(isOn ? Color(.systemBackground) : Color.primary)
                .padding(.horizontal, 14)
                .frame(maxWidth: fillsWidth ? .infinity : nil, minHeight: 32)
                .background {
                    if isOn {
                        Capsule().fill(Color.primary)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
