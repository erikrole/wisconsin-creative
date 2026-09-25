import SwiftUI

// MARK: - Sleep overlay
//
// Near-black burn-in-safe standby overlay. The whole cluster pixel-shifts on
// a 30-second cadence so nothing crisp sits in one place on the always-on
// panel. Extracted verbatim from KioskIdleView.swift (2026-07-02 rework
// Slice 5a).

struct KioskSleepModeView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let deviceName: String
    let onWake: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            Button(action: onWake) {
                ZStack {
                    Color.black.ignoresSafeArea()
                    VStack(spacing: 14) {
                        let parts = context.date.kioskClockParts()
                        (Text(parts.time)
                            .font(KioskType.standbyClock)
                            .foregroundStyle(Self.clockTone)
                        + Text(" \(parts.meridiem)")
                            .font(KioskType.standbyMeridiem)
                            .foregroundStyle(Self.dimTone))
                            .lineLimit(1)
                        Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(Self.dimTone)
                        Text("Tap or scan to wake")
                            .font(KioskType.body)
                            .foregroundStyle(Self.faintTone)
                            .padding(.top, 28)
                    }
                    .offset(reduceMotion ? .zero : pixelShiftOffset(for: context.date))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Kiosk standby, \(deviceName)")
            .accessibilityHint("Wake the kiosk")
        }
    }

    // Canvas J2: dim grey on black so nothing burns in overnight.
    private static let clockTone = Color(red: 0x4A / 255, green: 0x4A / 255, blue: 0x53 / 255)
    private static let dimTone = Color(red: 0x34 / 255, green: 0x34 / 255, blue: 0x3B / 255)
    private static let faintTone = Color(red: 0x2E / 255, green: 0x2E / 255, blue: 0x35 / 255)

    /// Drifts a few points every 30 s so no pixel holds one value all night.
    private func pixelShiftOffset(for date: Date) -> CGSize {
        let components = Calendar.current.dateComponents([.minute, .second], from: date)
        let slot = ((components.minute ?? 0) * 2) + ((components.second ?? 0) >= 30 ? 1 : 0)
        return CGSize(width: CGFloat((slot % 5) - 2) * 3, height: CGFloat(((slot / 5) % 5) - 2) * 3)
    }
}
