// PlexusApp — Entry point for the Plexus iOS client.
//
// Creates and wires the core services (SessionStore, ConnectionManager)
// and injects them into the SwiftUI environment.

import SwiftUI
import os

private let bootLogger = Logger(subsystem: "com.plexus.ios", category: "Boot")

@main
struct PlexusApp: App {

    @State private var sessionStore: SessionStore
    @State private var connectionManager: ConnectionManager

    init() {
        bootLogger.notice("Plexus app launching")
        let store = SessionStore()
        let manager = ConnectionManager(sessionStore: store)
        bootLogger.notice("hasTrustedBridge=\(manager.hasTrustedBridge, privacy: .public), state=\(String(describing: manager.state), privacy: .public)")
        _sessionStore = State(initialValue: store)
        _connectionManager = State(initialValue: manager)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(sessionStore)
                .environment(connectionManager)
        }
    }
}
