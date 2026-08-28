// ShieldActionExtension.swift
// App extension target: "Shield Action Extension". Handles the buttons on the shield.
//
// Primary always closes the blocked app (iOS forbids launching ChoreKey from here;
// the app group's `openRequested` flag lets the app react on its next foreground).
//
// Secondary taps are requests to the parent ("Ask for 15 minutes" on chores/bedtime,
// "I'm doing it now!" on critical). The extension's lifetime is too short to trust a
// network call, so taps are enqueued durably in the app group; the main app drains the
// queue to Supabase on next launch/foreground (ScreenTimePlugin.drainShieldRequests).
// The shield stays up (.defer) — there is no false "granted" moment.

import Foundation
import ManagedSettings

class ShieldActionExtension: ShieldActionDelegate {
    private let defaults = UserDefaults(suiteName: "group.app.chorelock")

    override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, completionHandler)
    }
    override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, completionHandler)
    }
    override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, completionHandler)
    }

    private func respond(_ action: ShieldAction, _ done: (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            defaults?.set(true, forKey: "openRequested")
            done(.close)
        case .secondaryButtonPressed:
            let state = defaults?.string(forKey: "shieldState") ?? "chores"
            let kind = state == "critical" ? "inprogress" : "fifteen"
            var queue = defaults?.array(forKey: "shieldRequestQueue") as? [[String: Any]] ?? []
            // One pending entry per kind is plenty — mashing the button shouldn't spam.
            if !queue.contains(where: { ($0["kind"] as? String) == kind }) {
                queue.append(["kind": kind, "at": Date().timeIntervalSince1970])
                defaults?.set(queue, forKey: "shieldRequestQueue")
            }
            done(.defer)
        default:
            done(.close)
        }
    }
}
