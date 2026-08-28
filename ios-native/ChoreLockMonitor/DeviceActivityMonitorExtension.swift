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

    // Night watch: record threshold crossings ("watched apps used >= N min in the night
    // window" / "first screen use after wake time") as anonymous timestamps for the app
    // to sync. No app identities are involved, so this data may leave the device.
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        let kind: String
        switch (activity.rawValue, event.rawValue) {
        case ("chorelock.night", "nightUse"): kind = "night"
        case ("chorelock.wake", "firstUse"): kind = "wake"
        default: return
        }
        var events = defaults?.array(forKey: "nightEvents") as? [[String: Any]] ?? []
        events.append(["kind": kind, "at": Date().timeIntervalSince1970])
        if events.count > 60 { events.removeFirst(events.count - 60) }
        defaults?.set(events, forKey: "nightEvents")
    }

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
