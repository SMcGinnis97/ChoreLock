import UIKit
import Capacitor
import ManagedSettings
import FamilyControls

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // MARK: - APNs → Capacitor PushNotifications plugin

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    /// Silent (content-available) pushes: the plugin's listener fires via the notification centre; we also
    /// tell iOS we fetched new data so the app gets background time to refetch and re-apply the shield.
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        // Apply the server-computed lock state natively first: the web view may never get
        // to run on a background push, and this is what lifts/raises the shield on time.
        PushLock.apply(userInfo)
        NotificationCenter.default.post(name: Notification.Name("CapacitorPushNotificationReceived"), object: userInfo)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { completionHandler(.newData) }
    }
}

/// Drives the shield straight from a push's `lock` payload ({ state, shield }, built by
/// kid_shield() on the server). Mirrors PushLock in ChoreLockComms/NotificationService.swift,
/// which covers visible pushes even when the app is force-quit — keep the two in step.
enum PushLock {
    static func apply(_ userInfo: [AnyHashable: Any]) {
        guard let lock = userInfo["lock"] as? [String: Any],
              let state = lock["state"] as? String,
              let defaults = UserDefaults(suiteName: "group.app.chorelock") else { return }
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
