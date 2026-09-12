// DeviceActivityMonitorExtension.swift
// App extension target: "Device Activity Monitor Extension" (DeviceActivity framework).
// Fires at the family's daily reset time (scheduled by ScreenTimePlugin.scheduleDailyReset)
// and re-applies the shield from the stored FamilyActivitySelection — works offline.
// The app's next launch / silent push then reconciles with the server (which may unlock
// immediately if there are no chores today).
// Also handles one-shot critical-task lock moments and the nightly bedtime window.
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

    // Fires for the daily reset, one-shot critical-task lock moments
    // (chorelock.criticalLock.N, registered by scheduleCriticalLocks) and the bedtime
    // window (chorelock.bedtime / chorelock.bedtime.N, registered by configureBedtime).
    // Either way the shield engages from stored state with zero network — the app
    // reconciles (and unlocks if the round was completed meanwhile) on its next wake.
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        let isReset = activity == DeviceActivityName("chorelock.dailyReset")
        let isCriticalLock = activity.rawValue.hasPrefix("chorelock.criticalLock.")
        let isBedtime = activity.rawValue.hasPrefix("chorelock.bedtime")
        guard isReset || isCriticalLock || isBedtime else { return }
        if isReset {
            // Lets the bedtime end know a reset happened inside the window (see intervalDidEnd).
            defaults?.set(Date().timeIntervalSince1970, forKey: "lastResetAt")
        }
        if isCriticalLock {
            let payloads = defaults?.dictionary(forKey: "criticalLockPayloads") as? [String: [String: String]]
            let p = payloads?[activity.rawValue]
            defaults?.set("critical", forKey: "shieldState")
            defaults?.set(p?["title"] ?? "🚨 Critical task", forKey: "shieldTitle")
            defaults?.set(p?["subtitle"] ?? "Nothing unlocks until it’s done.", forKey: "shieldSubtitle")
            defaults?.set(false, forKey: "shieldAllowRequest")
        }
        if isBedtime {
            // "Stay up tonight": the parent skipped this evening — leave the device alone.
            if let skip = defaults?.string(forKey: "bedtimeSkipEvening"), skip == Self.localDate(Date()) { return }
            defaults?.set(Date().timeIntervalSince1970, forKey: "bedtimeStartedAt")
            // A grounding or critical lock already owns the shield copy; keep it.
            if !(defaults?.bool(forKey: "bedtimeSuppressed") ?? false) {
                let payloads = defaults?.dictionary(forKey: "bedtimePayloads") as? [String: [String: String]]
                let p = payloads?[activity.rawValue]
                defaults?.set("bedtime", forKey: "shieldState")
                defaults?.set(p?["title"] ?? "Goodnight 🌙", forKey: "shieldTitle")
                defaults?.set(p?["subtitle"] ?? "Screens are back in the morning.", forKey: "shieldSubtitle")
                defaults?.set(defaults?.object(forKey: "bedtimeAllowRequest") as? Bool ?? true, forKey: "shieldAllowRequest")
            }
        }
        shield()
    }

    // Bedtime window closed: restore what the app last computed WITHOUT bedtime
    // (bedtimeAfter, kept fresh by setShield) — unless the daily reset fired during the
    // window, in which case today's chores are unknown here and we err locked with the
    // generic reset copy, exactly as the reset itself does. A later app wake reconciles.
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard activity.rawValue.hasPrefix("chorelock.bedtime") else { return }
        // Something higher-priority (grounded/critical) took the shield meanwhile: leave it.
        guard (defaults?.string(forKey: "shieldState") ?? "") == "bedtime" else { return }
        let startedAt = defaults?.double(forKey: "bedtimeStartedAt") ?? 0
        let resetAt = defaults?.double(forKey: "lastResetAt") ?? 0
        if resetAt > startedAt {
            defaults?.set("chores", forKey: "shieldState")
            defaults?.set("Chores first 🔑", forKey: "shieldTitle")
            defaults?.set("Open ChoreKey to snap your proof.", forKey: "shieldSubtitle")
            defaults?.set(true, forKey: "shieldAllowRequest")
            shield()
            return
        }
        let after = defaults?.dictionary(forKey: "bedtimeAfter") ?? [:]
        defaults?.set((after["state"] as? String) ?? "chores", forKey: "shieldState")
        defaults?.set((after["title"] as? String) ?? "Chores first 🔑", forKey: "shieldTitle")
        defaults?.set((after["subtitle"] as? String) ?? "Open ChoreKey to snap your proof.", forKey: "shieldSubtitle")
        defaults?.set((after["allowRequest"] as? Bool) ?? true, forKey: "shieldAllowRequest")
        if (after["enabled"] as? Bool) ?? false {
            shield()
        } else {
            store.clearAllSettings()
            defaults?.set(false, forKey: "shielded")
        }
    }

    private func shield() {
        guard let data = defaults?.data(forKey: "blockedSelection"),
              let sel = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else { return }
        store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
        store.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
        store.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
        store.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
        defaults?.set(true, forKey: "shielded")
    }

    /// YYYY-MM-DD in the device's zone — matches the app's localDate()/bedtimeNow().
    private static func localDate(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
