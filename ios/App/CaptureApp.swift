import SwiftUI
import UIKit

@main
struct CaptureApp: App {
    @UIApplicationDelegateAdaptor(CaptureAppDelegate.self) private var appDelegate
    @State private var library = CaptureLibrary()

    var body: some Scene {
        WindowGroup {
            RootView(library: library)
        }
    }
}

/// Supplies the orientation mask so the capture flow can lock the interface
/// to the orientation the scan started in.
final class CaptureAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        MainActor.assumeIsolated { CaptureOrientationLock.currentMask }
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        CaptureBundleExporter.clearExports()
        return true
    }
}
