import Foundation
import UserNotifications
import Intents

/// Notification Service Extension: rewrites summon pushes as *communication*
/// notifications so they render like a message from the parent (name shown as
/// the sender, Messages-style presentation) and can break through Focus when
/// the parent is an allowed person. Pushes carry `mutable-content: 1` plus a
/// top-level `senderName`; anything else passes through untouched.
class NotificationService: UNNotificationServiceExtension {

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        let content = request.content
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
