// ShieldConfigurationExtension.swift
// App extension target: "Shield Configuration Extension" (ManagedSettingsUI).
// Draws the screen the kid sees when they open a shielded app.
// Must share App Group `group.app.chorelock` with the main app.
//
// Four states, driven by `shieldState` in the shared defaults. Titles and
// subtitles arrive with {placeholders} already substituted by the main app —
// this extension does no network work and no string building beyond fallbacks.
//
// Icons must live in THIS target's asset catalog, not the main app's.

import ManagedSettings
import ManagedSettingsUI
import UIKit

private enum ShieldState: String {
    case chores, critical, grounded, bedtime

    static func current(_ d: UserDefaults?) -> ShieldState {
        ShieldState(rawValue: d?.string(forKey: "shieldState") ?? "") ?? .chores
    }
}

private extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private let defaults = UserDefaults(suiteName: "group.app.chorelock")

    private func config() -> ShieldConfiguration {
        let state = ShieldState.current(defaults)
        let title = defaults?.string(forKey: "shieldTitle") ?? fallbackTitle(state)
        let subtitle = defaults?.string(forKey: "shieldSubtitle") ?? fallbackSubtitle(state)
        // Suppressed after a parent denies a request in the last hour.
        // Apple has no disabled button style, so we omit the button entirely.
        let allowRequest = defaults?.object(forKey: "shieldAllowRequest") as? Bool ?? true

        switch state {
        // Backgrounds are near-opaque over a dark blur: the earlier translucent tints let
        // the blocked app bleed through and washed the white copy out to nothing.
        case .chores:
            return ShieldConfiguration(
                backgroundBlurStyle: .systemThickMaterialDark,
                backgroundColor: UIColor(hex: 0xD84A16, alpha: 0.97),
                icon: UIImage(named: "shield-chores"),
                title: .init(text: title, color: .white),
                subtitle: .init(text: subtitle, color: .white),
                primaryButtonLabel: .init(text: "See my chores →", color: UIColor(hex: 0xB23A10)),
                primaryButtonBackgroundColor: .white,
                secondaryButtonLabel: allowRequest
                    ? .init(text: "Ask for 15 minutes 🙏", color: .white)
                    : nil
            )

        case .critical:
            return ShieldConfiguration(
                backgroundBlurStyle: .systemThickMaterialDark,
                backgroundColor: UIColor(hex: 0x9E1710, alpha: 0.97),
                icon: UIImage(named: "shield-critical"),
                title: .init(text: title, color: .white),
                subtitle: .init(text: subtitle, color: .white),
                primaryButtonLabel: .init(text: "Close and go do it", color: UIColor(hex: 0x8E1610)),
                primaryButtonBackgroundColor: .white,
                secondaryButtonLabel: .init(text: "I'm doing it now! 💪", color: .white)
            )

        case .grounded:
            return ShieldConfiguration(
                backgroundBlurStyle: .systemThickMaterialDark,
                backgroundColor: UIColor(hex: 0x23272F, alpha: 0.97),
                icon: UIImage(named: "shield-grounded"),
                title: .init(text: title, color: .white),
                subtitle: .init(text: subtitle, color: UIColor(hex: 0xE3E7EF)),
                primaryButtonLabel: .init(text: "Close app", color: .white),
                primaryButtonBackgroundColor: UIColor(hex: 0x4A5260),
                secondaryButtonLabel: nil // no negotiating with a grounding
            )

        case .bedtime:
            // Clearly indigo, not another near-black: field test 2026-09-12 read the
            // grounded (slate) and bedtime (0x1B2049) shields as the same screen.
            return ShieldConfiguration(
                backgroundBlurStyle: .systemThickMaterialDark,
                backgroundColor: UIColor(hex: 0x3730A3, alpha: 0.97),
                icon: UIImage(named: "shield-bedtime"),
                title: .init(text: title, color: .white),
                subtitle: .init(text: subtitle, color: UIColor(hex: 0xE4E7FF)),
                primaryButtonLabel: .init(text: "Put it down", color: .white),
                primaryButtonBackgroundColor: UIColor(hex: 0x4A54B0),
                secondaryButtonLabel: allowRequest
                    ? .init(text: "Ask for 15 minutes 🙏", color: .white)
                    : nil
            )
        }
    }

    private func fallbackTitle(_ s: ShieldState) -> String {
        switch s {
        case .chores:   return "Chores first 🔑"
        case .critical: return "⏰ One thing is overdue"
        case .grounded: return "Grounded"
        case .bedtime:  return "Goodnight 🌙"
        }
    }

    private func fallbackSubtitle(_ s: ShieldState) -> String {
        switch s {
        case .chores:   return "Open ChoreKey to snap your proof."
        case .critical: return "Finish it and everything unlocks."
        case .grounded: return "Only a parent can lift this early."
        case .bedtime:  return "Screens are back in the morning."
        }
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration { config() }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration { config() }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { config() }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration { config() }
}
