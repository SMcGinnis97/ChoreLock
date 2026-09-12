// MyViewController.swift
// Custom bridge view controller so app-local Capacitor plugins actually register.
// Capacitor only auto-registers plugins shipped as pods; classes compiled into the
// app target (ScreenTimePlugin) must be registered here or every JS call to them
// rejects with "not implemented".
// ios-setup.rb points Main.storyboard at this class.

import UIKit
import Capacitor

class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScreenTimePlugin())
        // WKWebView does not reliably fire `visibilitychange` when the app comes back
        // from the switcher, so the web app never refetched after the midnight reset
        // until force-quit. Post an explicit resume event on every foreground.
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.bridge?.triggerWindowJSEvent(eventName: "chorekeyResume")
        }
    }
}
