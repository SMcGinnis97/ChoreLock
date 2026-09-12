import Foundation
import UserNotifications
import Intents
import ManagedSettings
import FamilyControls

/// Notification Service Extension. Two jobs:
///
/// 1. **Apply the lock state natively.** Every visible push carries `mutable-content: 1`
///    and a top-level `lock` object ({ state, shield }) computed by kid_shield() on the
///    server. This extension runs for every such push — app backgrounded, suspended, or
///    force-quit — so the ManagedSettings shield engages (or lifts) the moment the push
///    lands, without waiting for the web view to wake. Observed before this: grounding
///    showed the alert on the iPad but everything kept running until the app was opened.
///
/// 2. Rewrite summon pushes as *communication* notifications so they render like a
///    message from the parent (name shown as the sender, Messages-style presentation)
///    and can break through Focus when the parent is an allowed person. Those carry a
///    top-level `senderName`; anything else passes through untouched.
class NotificationService: UNNotificationServiceExtension {

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        let content = request.content
        PushLock.apply(content.userInfo)

        guard let sender = content.userInfo["senderName"] as? String, !sender.isEmpty else {
            contentHandler(content)
            return
        }

        let handle = INPersonHandle(value: "chorekey-parent", type: .unknown)
        let person = INPerson(personHandle: handle,
                              nameComponents: nil,
                              displayName: sender,
                              image: nil,
                              contactIdentifier: nil,
                              customIdentifier: "chorekey-parent")
        let intent = INSendMessageIntent(recipients: nil,
                                         outgoingMessageType: .outgoingMessageText,
                                         content: content.body,
                                         speakableGroupName: nil,
                                         conversationIdentifier: "chorekey-\(content.userInfo["kind"] as? String ?? "message")",
                                         serviceName: nil,
                                         sender: person,
                                         attachments: nil)
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate(completion: nil)

        if let updated = try? request.content.updating(from: intent) {
            contentHandler(updated)
        } else {
            contentHandler(content)
        }
    }
}

/// Drives the shield straight from a push's `lock` payload. Mirrors PushLock in
/// AppDelegate.swift (which covers silent pushes, where no service extension runs) —
/// keep the two in step. The app group holds the FamilyActivitySelection and the
/// shield copy the ShieldConfiguration extension renders.
enum PushLock {
    static func apply(_ userInfo: [AnyHashable: Any]) {
        guard let lock = userInfo["lock"] as? [String: Any],
              let state = lock["state"] as? String,
              let defaults = UserDefaults(suiteName: "group.app.chorelock") else { return }
        // Only when this extension actually holds the Family Controls entitlement (Apple
        // approves distribution per bundle id); otherwise leave it to the app delegate.
        guard AuthorizationCenter.shared.authorizationStatus == .approved else { return }
        if let s = lock["shield"] as? [String: Any] {
            if let v = s["state"] as? String { defaults.set(v, forKey: "shieldState") }
            if let v = s["title"] as? String { defaults.set(v, forKey: "shieldTitle") }
            if let v = s["subtitle"] as? String { defaults.set(v, forKey: "shieldSubtitle") }
            if let v = s["allowRequest"] as? Bool { defaults.set(v, forKey: "shieldAllowRequest") }
        }
        let store = ManagedSettingsStore(named: .init("chorelock"))
        if state == "locked" {
            guard let data = defaults.data(forKey: "blockedSelection"),
                  let sel = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) else { return }
            store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
            store.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
            store.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
            store.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
            defaults.set(true, forKey: "shielded")
        } else if state == "unlocked" {
            store.clearAllSettings()
            defaults.set(false, forKey: "shielded")
        }
    }
}
