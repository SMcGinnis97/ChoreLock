// ShieldActionExtension.swift
// App extension target: "Shield Action Extension". Handles the buttons on the shield.
// "Open ChoreLock" -> opens the app via URL scheme (chorelock://) is not allowed
// directly from an extension, so we defer and the app picks it up on next foreground.

import Foundation
import ManagedSettings

class ShieldActionExtension: ShieldActionDelegate {
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
            UserDefaults(suiteName: "group.app.chorelock")?.set(true, forKey: "openRequested")
            done(.close)
        default:
            done(.close)
        }
    }
}
