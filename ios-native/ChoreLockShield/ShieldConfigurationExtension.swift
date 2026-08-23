// ShieldConfigurationExtension.swift
// App extension target: "Shield Configuration Extension" (ManagedSettingsUI).
// Draws the screen the kid sees when they open a shielded app.
// Must share App Group `group.app.chorelock` with the main app.

import ManagedSettings
import ManagedSettingsUI
import UIKit

class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private let defaults = UserDefaults(suiteName: "group.app.chorelock")

    private func config() -> ShieldConfiguration {
        let title = defaults?.string(forKey: "shieldTitle") ?? "Locked until chores are done 🔒"
        let subtitle = defaults?.string(forKey: "shieldSubtitle") ?? "Open ChoreKey to snap your proof."
        return ShieldConfiguration(
            backgroundBlurStyle: .systemThickMaterialDark,
            backgroundColor: UIColor(red: 0.898, green: 0.329, blue: 0.118, alpha: 1), // #E5541E locked orange
            icon: UIImage(systemName: "lock.fill"),
            title: .init(text: title, color: .white),
            subtitle: .init(text: subtitle, color: UIColor.white.withAlphaComponent(0.9)),
            primaryButtonLabel: .init(text: "Open ChoreKey", color: UIColor(red: 0.898, green: 0.329, blue: 0.118, alpha: 1)),
            primaryButtonBackgroundColor: .white,
            secondaryButtonLabel: .init(text: "Not now", color: .white)
        )
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration { config() }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration { config() }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { config() }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration { config() }
}
