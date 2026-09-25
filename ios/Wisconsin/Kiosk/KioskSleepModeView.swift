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
                    VStack(alignment: .leading, spacing: 8) {
                        Text(context.date.kioskClockParts().time)
                            .font(.system(size: 72, weight: .heavy))
                            .foregroundStyle(Color.white.opacity(0.42))
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        HStack(spacing: 8) {
                            Image(systemName: "moon.zzz.fill")
                                .font(KioskType.chip)
                                .accessibilityHidden(true)
                            Text(context.date, format: .dateTime.weekday(.wide).month(.abbreviated).day())
                                .font(KioskType.chip)
                        }
                        .foregroundStyle(Color.white.opacity(0.42))
                        Text(deviceName)
                            .font(KioskType.chip)
                            .foregroundStyle(Color.white.opacity(0.64))
                        HStack(spacing: 6) {
                            Image(systemName: "hand.tap.fill")
                                .font(KioskType.micro)
                            Text("Tap anywhere to wake")
                                .font(KioskType.micro)
                        }
                        .foregroundStyle(Color.white.opacity(0.5))
                        .padding(.top, 6)
                    }
                    .offset(reduceMotion ? .zero : pixelShiftOffset(for: context.date))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Kiosk sleep mode")
            .accessibilityHint("Wake the kiosk")
        }
    }

    private func pixelShiftOffset(for date: Date) -> CGSize {
        let components = Calendar.current.dateComponents([.minute, .second], from: date)
        let minute = components.minute ?? 0
        let second = components.second ?? 0
        let slot = (minute * 2) + (second >= 30 ? 1 : 0)
        let x = CGFloat((slot % 9) - 4) * 38
        let y = CGFloat(((slot / 9) % 7) - 3) * 28
        return CGSize(width: x, height: y)
    }
}
