import SwiftUI
import UIKit

/// Native iOS text input for kiosk forms that need the system keyboard without
/// the iPad shortcut/suggestion assistant bar.
///
/// `fontSize` exists because a UIKit-backed field cannot take a SwiftUI
/// `.font(_:)` from its call site — the size was hardcoded at 15pt, which is
/// what a form field looks like in an iPhone app held at reading distance and
/// not what a booking name should look like on a mounted iPad read across a
/// counter. Call sites that want the compact size simply omit it.
struct KioskNativeTextField: UIViewRepresentable {
    let placeholder: String
    @Binding var text: String
    @Binding var isFocused: Bool
    var fontSize: CGFloat = 15
    var fontWeight: UIFont.Weight = .semibold

    func makeUIView(context: Context) -> UITextField {
        let field = KioskKeyboardTextField()
        field.delegate = context.coordinator
        field.borderStyle = .none
        field.backgroundColor = .clear
        field.textColor = UIColor.label
        field.tintColor = UIColor(Color.kioskRed)
        field.font = UIFont.systemFont(ofSize: fontSize, weight: fontWeight)
        field.returnKeyType = .done
        field.autocapitalizationType = .words
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.smartDashesType = .no
        field.smartQuotesType = .no
        field.smartInsertDeleteType = .no
        field.textContentType = nil
        field.inputAssistantItem.leadingBarButtonGroups = []
        field.inputAssistantItem.trailingBarButtonGroups = []
        field.addTarget(context.coordinator, action: #selector(Coordinator.textDidChange(_:)), for: .editingChanged)
        return field
    }

    func updateUIView(_ uiView: UITextField, context: Context) {
        context.coordinator.parent = self
        if uiView.text != text {
            uiView.text = text
        }
        let resolvedFont = UIFont.systemFont(ofSize: fontSize, weight: fontWeight)
        if uiView.font != resolvedFont {
            uiView.font = resolvedFont
        }
        uiView.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [
                .foregroundColor: UIColor.secondaryLabel,
                .font: resolvedFont
            ]
        )
        uiView.inputAssistantItem.leadingBarButtonGroups = []
        uiView.inputAssistantItem.trailingBarButtonGroups = []

        if isFocused {
            HIDScannerFocusGate.suppressScannerFocus()
        }

        if isFocused, !uiView.isFirstResponder {
            DispatchQueue.main.async {
                HIDScannerFocusGate.suppressScannerFocus()
                uiView.becomeFirstResponder()
            }
        } else if !isFocused, uiView.isFirstResponder {
            if let field = uiView as? KioskKeyboardTextField {
                field.forceResignFirstResponder()
            } else {
                uiView.resignFirstResponder()
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: KioskNativeTextField

        init(parent: KioskNativeTextField) {
            self.parent = parent
        }

        @objc func textDidChange(_ textField: UITextField) {
            (textField as? KioskKeyboardTextField)?.protectKeyboard()
            HIDScannerFocusGate.suppressScannerFocus()
            parent.text = textField.text ?? ""
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            (textField as? KioskKeyboardTextField)?.protectKeyboard()
            HIDScannerFocusGate.suppressScannerFocus()
            parent.isFocused = true
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            parent.isFocused = false
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.isFocused = false
            if let field = textField as? KioskKeyboardTextField {
                field.forceResignFirstResponder()
            } else {
                textField.resignFirstResponder()
            }
            return false
        }

        // Scanner intake is deliberately owned by the separate hidden
        // `HIDScannerField`. Returning `true` here preserves UITextField's
        // native edit menu, Paste, drag-and-drop, and Scribble transactions;
        // those transactions must never be classified as scanner input.
        func textField(
            _ textField: UITextField,
            shouldChangeCharactersIn range: NSRange,
            replacementString string: String
        ) -> Bool { true }
    }
}

private final class KioskKeyboardTextField: UITextField {
    private static let resignProtectionDuration: TimeInterval = 1.2
    private var protectedUntil = Date.distantPast
    private var allowsForcedResign = false

    func protectKeyboard() {
        protectedUntil = Date().addingTimeInterval(Self.resignProtectionDuration)
    }

    func forceResignFirstResponder() {
        allowsForcedResign = true
        defer { allowsForcedResign = false }
        _ = super.resignFirstResponder()
    }

    override func resignFirstResponder() -> Bool {
        if !allowsForcedResign, Date() < protectedUntil {
            return false
        }
        return super.resignFirstResponder()
    }
}
