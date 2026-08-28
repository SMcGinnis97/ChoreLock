// ScreenTimePlugin.swift
// Capacitor plugin wrapping Apple's Screen Time APIs (FamilyControls / ManagedSettings).
// Drop into ios/App/App/ after `npx cap add ios`, and add to the App target.
//
// Requires:
//   - Entitlement: com.apple.developer.family-controls (request from Apple, see docs/)
//   - App Group shared with ChoreLockShield extension: group.app.chorelock
//   - iOS 16+
//
// Authorization mode is `.individual` (app installed on the kid's device). Once
// authorized, the parent uses pickBlockedApps() to open FamilyActivityPicker; the
// opaque selection is persisted and applied with setShield().

import Capacitor
import FamilyControls
import ManagedSettings
import DeviceActivity
import SwiftUI

@objc(ScreenTimePlugin)
public class ScreenTimePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenTimePlugin"
    public let jsName = "ScreenTime"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickBlockedApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSelectionSummary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setShield", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleDailyReset", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainShieldRequests", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureNightWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainNightEvents", returnType: CAPPluginReturnPromise),
    ]

    private let store = ManagedSettingsStore(named: .init("chorelock"))
    private let defaults = UserDefaults(suiteName: "group.app.chorelock")!
    private let selectionKey = "blockedSelection"
    private let shieldedKey = "shielded"

    // MARK: Authorization
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        Task {
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                call.resolve(["status": statusString()])
            } catch {
                call.resolve(["status": "denied"])
            }
        }
    }

    private func statusString() -> String {
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved: return "approved"
        case .denied: return "denied"
        default: return "notDetermined"
        }
    }

    // MARK: Picker
    @objc func pickBlockedApps(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var selection = self.loadSelection()
            let picker = PickerHost(selection: selection) { result in
                selection = result
                self.saveSelection(result)
                // If the shield is currently up it was built from the OLD selection —
                // re-apply immediately so the new picks take effect without waiting
                // for the next locked/unlocked transition.
                if self.defaults.bool(forKey: self.shieldedKey) { self.applyShield(enabled: true) }
                self.bridge?.viewController?.dismiss(animated: true)
                call.resolve(self.summary(result))
            }
            let host = UIHostingController(rootView: picker)
            host.modalPresentationStyle = .pageSheet
            self.bridge?.viewController?.present(host, animated: true)
        }
    }

    @objc func getSelectionSummary(_ call: CAPPluginCall) {
        call.resolve(summary(loadSelection()))
    }

    private func summary(_ s: FamilyActivitySelection) -> [String: Int] {
        ["appCount": s.applicationTokens.count, "categoryCount": s.categoryTokens.count, "webDomainCount": s.webDomainTokens.count]
    }

    private func loadSelection() -> FamilyActivitySelection {
        guard let data = defaults.data(forKey: selectionKey),
              let sel = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else { return FamilyActivitySelection() }
        return sel
    }

    private func saveSelection(_ s: FamilyActivitySelection) {
        if let data = try? JSONEncoder().encode(s) { defaults.set(data, forKey: selectionKey) }
    }

    // MARK: Shield
    @objc func setShield(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        // Per-state shield content (see ShieldConfigurationExtension): the app sends
        // already-substituted strings; the extension only reads and renders.
        if let st = call.getString("state") { defaults.set(st, forKey: "shieldState") }
        if let t = call.getString("title") { defaults.set(t, forKey: "shieldTitle") }
        if let s = call.getString("subtitle") { defaults.set(s, forKey: "shieldSubtitle") }
        if let a = call.getBool("allowRequest") { defaults.set(a, forKey: "shieldAllowRequest") }
        applyShield(enabled: enabled)
        call.resolve()
    }

    /// Returns and clears the shield-button taps queued by ShieldActionExtension
    /// (the extension can't do reliable network work; the app forwards these to Supabase).
    @objc func drainShieldRequests(_ call: CAPPluginCall) {
        let queue = defaults.array(forKey: "shieldRequestQueue") as? [[String: Any]] ?? []
        defaults.removeObject(forKey: "shieldRequestQueue")
        call.resolve(["requests": queue.map { ["kind": ($0["kind"] as? String) ?? "", "at": ($0["at"] as? Double) ?? 0] }])
    }

    func applyShield(enabled: Bool) {
        let sel = loadSelection()
        if enabled {
            store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
            store.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
            store.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
            store.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
        } else {
            store.clearAllSettings()
        }
        defaults.set(enabled, forKey: shieldedKey)
    }

    // MARK: Daily reset schedule (runs in ChoreLockMonitor extension, no network required)
    @objc func scheduleDailyReset(_ call: CAPPluginCall) {
        let hour = call.getInt("hour") ?? 0
        let minute = call.getInt("minute") ?? 0
        defaults.set(hour, forKey: "resetHour"); defaults.set(minute, forKey: "resetMinute")
        let center = DeviceActivityCenter()
        center.stopMonitoring([.dailyReset])
        // A one-minute window starting at reset time; intervalDidStart fires -> extension re-applies shield.
        let end = DateComponents(hour: (minute >= 59) ? (hour + 1) % 24 : hour, minute: (minute + 1) % 60)
        let schedule = DeviceActivitySchedule(intervalStart: DateComponents(hour: hour, minute: minute), intervalEnd: end, repeats: true)
        do {
            try center.startMonitoring(.dailyReset, during: schedule)
            call.resolve()
        } catch {
            call.reject("startMonitoring failed: \(error.localizedDescription)")
        }
    }

    // MARK: Night watch (3am flags + wake timecard)
    // Two repeating DeviceActivity schedules over the parent-set night window:
    //  - chorelock.night: threshold event when the watched selection is used >= N min
    //    inside the window ("a watched app was used at 2:14 AM") — token-anonymous.
    //  - chorelock.wake: a 1-minute threshold in the 6 hours after the window ends —
    //    the crossing time is "first screen use" for the timecard.
    // The monitor extension records crossings to the app group; drainNightEvents
    // hands them to the app to sync. Pass enabled=false to stop both.
    @objc func configureNightWatch(_ call: CAPPluginCall) {
        let center = DeviceActivityCenter()
        center.stopMonitoring([.night, .wake])
        guard call.getBool("enabled") ?? true else { call.resolve(); return }
        let sh = call.getInt("startHour") ?? 0, sm = call.getInt("startMinute") ?? 0
        let eh = call.getInt("endHour") ?? 5, em = call.getInt("endMinute") ?? 0
        let threshold = max(1, call.getInt("thresholdMinutes") ?? 15)
        let sel = loadSelection()
        let watched = DeviceActivityEvent(
            applications: sel.applicationTokens, categories: sel.categoryTokens,
            webDomains: sel.webDomainTokens, threshold: DateComponents(minute: threshold))
        let firstUse = DeviceActivityEvent(
            applications: sel.applicationTokens, categories: sel.categoryTokens,
            webDomains: sel.webDomainTokens, threshold: DateComponents(minute: 1))
        do {
            try center.startMonitoring(.night,
                during: DeviceActivitySchedule(intervalStart: DateComponents(hour: sh, minute: sm),
                                               intervalEnd: DateComponents(hour: eh, minute: em), repeats: true),
                events: [.nightUse: watched])
            try center.startMonitoring(.wake,
                during: DeviceActivitySchedule(intervalStart: DateComponents(hour: eh, minute: em),
                                               intervalEnd: DateComponents(hour: (eh + 6) % 24, minute: em), repeats: true),
                events: [.firstUse: firstUse])
            call.resolve()
        } catch {
            call.reject("night watch failed: \(error.localizedDescription)")
        }
    }

    @objc func drainNightEvents(_ call: CAPPluginCall) {
        let events = defaults.array(forKey: "nightEvents") as? [[String: Any]] ?? []
        defaults.removeObject(forKey: "nightEvents")
        call.resolve(["events": events.map { ["kind": ($0["kind"] as? String) ?? "", "at": ($0["at"] as? Double) ?? 0] }])
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        Task {
            // authorizationStatus settles asynchronously after a cold launch, so an
            // immediate read misreports an authorized device as notDetermined. Poll
            // briefly (≤1.5s) before answering; a genuinely never-asked device just
            // stays notDetermined and pays the short wait once.
            var waited = 0
            while AuthorizationCenter.shared.authorizationStatus == .notDetermined && waited < 15 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                waited += 1
            }
            call.resolve([
                "authorized": AuthorizationCenter.shared.authorizationStatus == .approved,
                "shielded": self.defaults.bool(forKey: self.shieldedKey),
            ])
        }
    }
}

// SwiftUI host for Apple's FamilyActivityPicker.
private struct PickerHost: View {
    @State var selection: FamilyActivitySelection
    let onDone: (FamilyActivitySelection) -> Void
    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("Blocked while locked")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { onDone(selection) } } }
        }
    }
}

extension DeviceActivityName {
    static let dailyReset = Self("chorelock.dailyReset")
    static let night = Self("chorelock.night")
    static let wake = Self("chorelock.wake")
}

extension DeviceActivityEvent.Name {
    static let nightUse = Self("nightUse")
    static let firstUse = Self("firstUse")
}
