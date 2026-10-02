import SwiftUI
import UIKit

/// Custody times are chosen in quarter-hour steps, and generated suggestions
/// always round forward so a smart default never promises an earlier return
/// than the source event or safety minimum. Shared by the kiosk and the
/// iPhone app so both agree on the grid.
enum QuarterHour {
    static let minuteInterval = 15
    private static let secondsPerInterval = TimeInterval(minuteInterval * 60)

    static func roundedUp(_ date: Date) -> Date {
        let intervals = date.timeIntervalSinceReferenceDate / secondsPerInterval
        return Date(timeIntervalSinceReferenceDate: ceil(intervals) * secondsPerInterval)
    }

    static func clamped(_ date: Date, minimum: Date) -> Date {
        roundedUp(max(date, minimum))
    }
}

/// Native compact time control with a real 15-minute wheel interval. SwiftUI's
/// `DatePicker` does not expose `UIDatePicker.minuteInterval`, which previously
/// made staff scroll through minute-by-minute values for a custody timestamp.
struct QuarterHourTimePicker: UIViewRepresentable {
    @Binding var selection: Date
    var minimumDate: Date?
    var tint: Color?
    var accessibilityLabel = "Time, 15-minute increments"

    func makeUIView(context: Context) -> UIDatePicker {
        let picker = UIDatePicker()
        picker.datePickerMode = .time
        picker.preferredDatePickerStyle = .compact
        picker.minuteInterval = QuarterHour.minuteInterval
        picker.addTarget(context.coordinator, action: #selector(Coordinator.valueChanged(_:)), for: .valueChanged)
        return picker
    }

    func updateUIView(_ picker: UIDatePicker, context: Context) {
        context.coordinator.parent = self
        picker.minimumDate = minimumDate
        picker.accessibilityLabel = accessibilityLabel
        if let tint { picker.tintColor = UIColor(tint) }
        if abs(picker.date.timeIntervalSince(selection)) >= 1 {
            picker.setDate(selection, animated: false)
        }
    }

    /// The compact picker's own size. Without it SwiftUI treats the UIKit
    /// view as flexible, and outside a ScrollView the chip floated in the
    /// middle of a stretched row.
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIDatePicker, context: Context) -> CGSize? {
        let fitted = uiView.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        return CGSize(width: max(fitted.width, 120), height: max(fitted.height, 44))
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject {
        var parent: QuarterHourTimePicker

        init(parent: QuarterHourTimePicker) {
            self.parent = parent
        }

        @objc func valueChanged(_ picker: UIDatePicker) {
            parent.selection = QuarterHour.roundedUp(picker.date)
        }
    }
}

/// Compact date chip plus the 15-minute time wheel, editing one `Date`.
/// Changing the day keeps the time of day (and vice versa), and the result is
/// never earlier than `minimumDate`.
struct QuarterHourDateTimeControls: View {
    let label: String
    @Binding var selection: Date
    var minimumDate: Date?
    var tint: Color?

    /// Reads rounded *up* to the grid: an off-grid value such as a 6:54 PM
    /// booking end would otherwise show as 6:45 PM, a time before it.
    private var clamped: Binding<Date> {
        Binding(
            get: { QuarterHour.roundedUp(selection) },
            set: { selection = QuarterHour.clamped($0, minimum: minimumDate ?? .distantPast) }
        )
    }

    private var dayBinding: Binding<Date> {
        Binding(
            get: { selection },
            set: { newDay in
                let calendar = Calendar.current
                var merged = calendar.dateComponents([.year, .month, .day], from: newDay)
                let time = calendar.dateComponents([.hour, .minute], from: selection)
                merged.hour = time.hour
                merged.minute = time.minute
                guard let value = calendar.date(from: merged) else { return }
                clamped.wrappedValue = value
            }
        )
    }

    var body: some View {
        HStack(spacing: 8) {
            DatePicker(
                "\(label) date",
                selection: dayBinding,
                in: (minimumDate.map { Calendar.current.startOfDay(for: $0) } ?? .distantPast)...,
                displayedComponents: .date
            )
            .labelsHidden()
            .fixedSize()

            QuarterHourTimePicker(
                selection: clamped,
                minimumDate: minimumDate,
                tint: tint,
                accessibilityLabel: "\(label) time, 15-minute increments"
            )
        }
        .tint(tint)
    }
}
