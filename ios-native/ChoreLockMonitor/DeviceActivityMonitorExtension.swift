// DeviceActivityMonitorExtension.swift
// App extension target: "Device Activity Monitor Extension" (DeviceActivity framework).
// Fires at the family's daily reset time (scheduled by ScreenTimePlugin.scheduleDailyReset)
// and re-applies the shield from the stored FamilyActivitySelection — works offline.
// The app's next launch / silent push then reconciles with the server (which may unlock
// immediately if there are no chores today).
// Shares App Group `group.app.chorelock`.

import Foundation
import DeviceActivity
import FamilyControls
import ManagedSettings

class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let store = ManagedSettingsStore(named: .init("chorelock"))
    private let defaults = UserDefaults(suiteName: "group.app.chorelock")

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        guard activity == DeviceActivityName("chorelock.dailyReset") else { return }
        guard let data = defaults?.data(forKey: "blockedSelection"),
              let sel = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else { return }
        store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
        store.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
        store.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
        store.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
        defaults?.set(true, forKey: "shielded")
    }
}
