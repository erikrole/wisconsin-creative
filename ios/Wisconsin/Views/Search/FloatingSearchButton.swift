import SwiftUI

struct FloatingSearchButton: View {
    @Binding var isPresented: Bool
    @State private var hapticTrigger = false

    var body: some View {
        Button {
            hapticTrigger.toggle()
            isPresented = true
        } label: {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 56, height: 56)
        }
        .buttonStyle(.glassProminent)
        .tint(Color.brandPrimary)
        .clipShape(Circle())
        .accessibilityLabel("Search")
    }
}
