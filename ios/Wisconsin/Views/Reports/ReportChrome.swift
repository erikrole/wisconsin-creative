import SwiftUI

/// Shared quiet chrome for the read-only report screens. Exports stay on the web.
struct ReportScreen<Content: View>: View {
    let title: String
    let isLoading: Bool
    let error: String?
    let hasData: Bool
    let retry: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        Group {
            if !hasData && error == nil {
                ProgressView("Loading \(title.lowercased())")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error, !hasData {
                ContentUnavailableView {
                    Label("Couldn't load \(title.lowercased())", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry", action: retry)
                        .buttonStyle(.borderedProminent)
                }
            } else {
                content()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if hasData && isLoading {
                ToolbarItem(placement: .topBarTrailing) {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Refreshing")
                }
            }
        }
    }
}

struct ReportDayPicker: View {
    let days: [Int]
    @Binding var selection: Int

    var body: some View {
        Picker("Period", selection: $selection) {
            ForEach(days, id: \.self) { day in
                Text(day == 0 ? "All" : "\(day)d").tag(day)
            }
        }
        .pickerStyle(.segmented)
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
    }
}

struct ReportMetricGrid: View {
    let metrics: [ReportMetricModel]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)],
            alignment: .leading,
            spacing: 14
        ) {
            ForEach(metrics) { metric in
                ReportMetric(model: metric)
            }
        }
        .padding(.vertical, 4)
    }
}

struct ReportMetricModel: Identifiable {
    let id: String
    let value: String
    let label: String
    var tone: StatusTone = .blue
    var delta: ReportDelta?
    var caption: String?
}

struct ReportMetric: View {
    let model: ReportMetricModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.statusText(model.tone))
            Text(model.label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(0.5)
                .foregroundStyle(.secondary)
            if let delta = model.delta {
                Label(delta.text, systemImage: delta.systemImage)
                    .labelStyle(.titleAndIcon)
                    .font(.caption2.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(Color.statusText(delta.tone))
            }
            if let caption = model.caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var parts = ["\(model.label): \(model.value)"]
        if let delta = model.delta { parts.append(delta.accessibilityText) }
        if let caption = model.caption, !caption.isEmpty { parts.append(caption) }
        return parts.joined(separator: ", ")
    }
}

struct ReportRankRow: View {
    let title: String
    let detail: String?
    let value: String
    let fraction: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline)
                    if let detail, !detail.isEmpty {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                Text(value)
                    .font(.subheadline.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Capsule()
                .fill(Color.chartFill(.neutral).opacity(0.18))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(Color.chartFill(.active))
                        .scaleEffect(x: min(max(fraction, 0), 1), y: 1, anchor: .leading)
                }
                .frame(height: 4)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(detail.map { "\(title), \($0), \(value)" } ?? "\(title), \(value)")
        .padding(.vertical, 2)
    }
}

struct ReportStaleNotice: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "wifi.exclamationmark")
            .font(.caption)
            .foregroundStyle(.secondary)
    }
}

struct ReportIncompleteNotice: View {
    let sections: [String]

    var body: some View {
        Label(
            "Some sections could not be calculated: \(sections.joined(separator: ", ")).",
            systemImage: "exclamationmark.triangle"
        )
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

func reportShare(_ count: Int, of values: [Int]) -> Double {
    let total = values.reduce(0, +)
    guard total > 0 else { return 0 }
    return Double(count) / Double(total)
}
