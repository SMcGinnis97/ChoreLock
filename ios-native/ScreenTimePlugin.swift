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
        if let t = call.getString("title") { defaults.set(t, forKey: "shieldTitle") }
        if let s = call.getString("subtitle") { defaults.set(s, forKey: "shieldSubtitle") }
        applyShield(enabled: enabled)
        call.resolve()
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
}
