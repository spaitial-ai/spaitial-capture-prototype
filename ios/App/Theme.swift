import SwiftUI

/// Neutral design tokens. Light and dark are both defined for every token.
///
/// Swap these for your own palette; nothing in the capture pipeline depends on them.
enum Theme {
    static let background = Color(light: 0xFC_FD_FE, dark: 0x0A_0B_0D)
    static let foreground = Color(light: 0x18_1B_1F, dark: 0xE6_E8_EB)
    static let card = Color(light: 0xFF_FF_FF, dark: 0x14_16_19)
    static let primary = Color(light: 0x0A_66_D8, dark: 0x4A_9A_FF)
    static let primaryForeground = Color(light: 0xFF_FF_FF, dark: 0x05_0A_12)
    static let muted = Color(light: 0xF0_F2_F5, dark: 0x1C_1F_23)
    static let mutedForeground = Color(light: 0x5E_66_70, dark: 0x8A_91_99)
    static let success = Color(light: 0x1E_9E_5A, dark: 0x3C_C9_7E)
    static let destructive = Color(light: 0xD3_2F_2F, dark: 0xF0_5A_5A)
    static let warning = Color(light: 0xE0_7B_00, dark: 0xF5_A3_1A)
    static let border = Color(light: 0xDD_E1_E6, dark: 0x26_2A_2F)

    /// Default radius for buttons and inputs.
    static let controlRadius: CGFloat = 12
    /// The accessibility floor for anything tappable.
    static let minimumTapTarget: CGFloat = 44
}

extension Color {
    /// A colour that resolves per appearance, so every token carries both modes.
    fileprivate init(light: UInt32, dark: UInt32) {
        self.init(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(hex: dark)
                    : UIColor(hex: light)
            }
        )
    }
}

extension UIColor {
    fileprivate convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
