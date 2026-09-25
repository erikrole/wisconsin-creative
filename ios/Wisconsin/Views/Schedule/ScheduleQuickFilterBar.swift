import SwiftUI

/// Event type chips under the week strip, plus a removable chip for the sport
/// set from the toolbar. Everything the list is narrowed by stays visible
/// here, so undoing one never means hunting for the control that set it.
struct ScheduleQuickFilterBar: View {
    @Binding var homeAwayFilter: HomeAwayFilter
    let sportLabel: String?
    let onClearSport: () -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                if let sportLabel {
                    RemovableFilterChip(title: sportLabel, action: onClearSport)
                }
                ForEach(HomeAwayFilter.allCases, id: \.self) { filter in
                    ScheduleFilterChip(
                        title: filter.rawValue,
                        isOn: homeAwayFilter == filter
                    ) {
                        homeAwayFilter = filter
                        Haptics.selection()
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Event type")
    }
}

private struct ScheduleFilterChip: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(isOn ? .semibold : .regular))
                .foregroundStyle(isOn ? Color(.systemBackground) : Color.primary)
                .padding(.horizontal, 14)
                .frame(minHeight: 32)
                .background {
                    if isOn {
                        Capsule().fill(Color.primary)
                    } else {
                        Capsule().strokeBorder(Color.primary.opacity(0.18), lineWidth: 1)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

private struct RemovableFilterChip: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Image(systemName: "xmark")
                    .font(.caption2.weight(.bold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.brandPrimary)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(Capsule().fill(Color.brandPrimary.opacity(0.12)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(title) filter")
    }
}
